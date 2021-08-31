const assert = require('assert');
const { initializeToken, call, send, increaseEvmBlock, toBytes32 } = require('./funcs');
const { toWad, fromWad, infinity, Side } = require('./constants');
const { buildOrder, getOrderHash } = require('./order');

const TestToken = artifacts.require('test/TestToken.sol');
const TestFundingMock = artifacts.require('test/TestFundingMock.sol');
const Perpetual = artifacts.require('test/TestPerpetual.sol');
const GlobalConfig = artifacts.require('perpetual/GlobalConfig.sol');
const Exchange = artifacts.require('exchange/Exchange.sol');
const AMM = artifacts.require('test/TestAMM.sol');
const Proxy = artifacts.require('proxy/Proxy.sol');
const PriceFeeder = artifacts.require('test/TestPriceFeeder.sol');

contract('exchange-user-reverse', accounts => {
    const FLAT = 0;
    const SHORT = 1;
    const LONG = 2;

    let priceFeeder;
    let collateral;
    let globalConfig;
    let funding;
    let perpetual;
    let exchange;
    let proxy;
    let amm;

    const broker = accounts[9];
    const admin = accounts[0];
    const dev = accounts[1];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];
    const u4 = accounts[7];

    const users = {
        broker,
        admin,
        u1,
        u2,
        u3,
        u4,
    };

    const deploy = async (cDecimals = 18, pDecimals = 18) => {
        priceFeeder = await PriceFeeder.new();
        collateral = await TestToken.new("TT", "TestToken", cDecimals);
        globalConfig = await GlobalConfig.new();
        funding = await TestFundingMock.new();
        exchange = await Exchange.new(globalConfig.address);
        perpetual = await Perpetual.new(
            globalConfig.address,
            dev,
            collateral.address,
            cDecimals
        );
        proxy = await Proxy.new(perpetual.address);
        amm = await AMM.new(globalConfig.address, proxy.address, priceFeeder.address);
        await perpetual.setGovernanceAddress(toBytes32("amm"), funding.address);

        await globalConfig.addBroker(admin);
        await globalConfig.addComponent(perpetual.address, exchange.address);
    };

    const setDefaultGovParameters = async () => {
        await perpetual.setGovernanceParameter(toBytes32("initialMarginRate"), toWad(0.1));
        await perpetual.setGovernanceParameter(toBytes32("maintenanceMarginRate"), toWad(0.05));
        await perpetual.setGovernanceParameter(toBytes32("liquidationPenaltyRate"), toWad(0.005));
        await perpetual.setGovernanceParameter(toBytes32("penaltyFundRate"), toWad(0.005));
        await perpetual.setGovernanceParameter(toBytes32("takerDevFeeRate"), toWad(0.01));
        await perpetual.setGovernanceParameter(toBytes32("makerDevFeeRate"), toWad(0.01));
        await perpetual.setGovernanceParameter(toBytes32("lotSize"), 1);
        await perpetual.setGovernanceParameter(toBytes32("tradingLotSize"), 1);

        await amm.setGovernanceParameter(toBytes32("poolFeeRate"), toWad(0.0006)); // 0.075% * 80%
        await amm.setGovernanceParameter(toBytes32("poolDevFeeRate"), toWad(0.00015)); // 0.075% * 20%
        await amm.setGovernanceParameter(toBytes32("emaAlpha"), "3327787021630616"); // 2 / (600 + 1)
        await amm.setGovernanceParameter(toBytes32("updatePremiumPrize"), toWad(0));
        await amm.setGovernanceParameter(toBytes32("markPremiumLimit"), toWad(0.005));
        await amm.setGovernanceParameter(toBytes32("fundingDampener"), toWad(0.0005));
    };

    const positionSize = async (user) => {
        const positionAccount = await perpetual.getMarginAccount(user);
        return positionAccount.size;
    }

    const positionSide = async (user) => {
        const positionAccount = await perpetual.getMarginAccount(user);
        return positionAccount.side;
    }

    const positionEntryValue = async (user) => {
        const positionAccount = await perpetual.getMarginAccount(user);
        return positionAccount.entryValue;
    }

    const cashBalanceOf = async (user) => {
        const cashAccount = await perpetual.getMarginAccount(user);
        return cashAccount.cashBalance;
    }

    beforeEach(async () => {
        await deploy();
        await setDefaultGovParameters();
    });

    const setIndexPrice = async price => {
        await priceFeeder.setPrice(toWad(price));

        // priceFeeder will modify index.timestamp, amm.timestamp should >= index.timestamp
        const index = await amm.indexPrice();
        await amm.setBlockTimestamp(index.timestamp);
    };

    it("validate", async () => {
        await collateral.transfer(u1, toWad(10000));
        await collateral.approve(perpetual.address, infinity, { from: u1 });
        await perpetual.deposit(toWad(10000), { from: u1 });
        assert.equal(fromWad(await cashBalanceOf(u1)), 10000);

        await collateral.transfer(u2, toWad(10000));
        await collateral.approve(perpetual.address, infinity, { from: u2 });
        await perpetual.deposit(toWad(10000), { from: u2 });
        assert.equal(fromWad(await cashBalanceOf(u2)), 10000);

        await funding.setMarkPrice(toWad(6000));
        const takerParam = {
            trader: u1,
            amount: 1,
            price: 6000,
            version: 2,
            side: 'sell',
            type: 'limit',
            expiredAtSeconds: 86400,
            makerFeeRate: 1000,
            takerFeeRate: 100,
            salt: 666,
            inversed: true,
        };

        const makerParam = {
            trader: u2,
            amount: 1,
            price: 6000,
            version: 2,
            side: 'buy',
            type: 'limit',
            expiredAtSeconds: 86400,
            makerFeeRate: 1000,
            takerFeeRate: 100,
            inversed: false,
        };
        try {
            await exchange.matchOrders(
                await buildOrder(takerParam, perpetual.address, admin),
                [await buildOrder(makerParam, perpetual.address, admin)],
                perpetual.address,
                [toWad(1)]
            );
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("invalid inversed pair"), error);
        }
    });

    it("trade 1v1", async () => {
        await setIndexPrice('0.005');

        await collateral.transfer(u1, toWad(10000));
        await collateral.approve(perpetual.address, infinity, { from: u1 });
        await perpetual.deposit(toWad(10000), { from: u1 });
        assert.equal(fromWad(await cashBalanceOf(u1)), 10000);

        await collateral.transfer(u2, toWad(10000));
        await collateral.approve(perpetual.address, infinity, { from: u2 });
        await perpetual.deposit(toWad(10000), { from: u2 });
        assert.equal(fromWad(await cashBalanceOf(u2)), 10000);

        await funding.setMarkPrice(toWad(0.005));

        const takerParam = await buildOrder({
            trader: u1,
            amount: 1,
            price: 200,
            version: 2,
            side: 'buy',
            type: 'limit',
            expiredAtSeconds: 86400,
            makerFeeRate: 0,
            takerFeeRate: 0,
            salt: 666,
            inversed: true,
        }, perpetual.address, admin);

        const makerParam = await buildOrder({
            trader: u2,
            amount: 1,
            price: 200,
            version: 2,
            side: 'sell',
            type: 'limit',
            expiredAtSeconds: 86400,
            makerFeeRate: 0,
            takerFeeRate: 0,
            salt: 666,
            inversed: true,
        }, perpetual.address, admin);

        await exchange.matchOrders(
            takerParam,
            [
                makerParam
            ],
            perpetual.address,
            [
                toWad(1)
            ]
        );

        assert.equal(fromWad(await perpetual.markPrice.call()), 0.005);

        // p = 1/200 = 0.005
        assert.equal(fromWad(await cashBalanceOf(u1)), 10000 - 0.00005);
        assert.equal(await positionSide(u1), SHORT);
        assert.equal(fromWad(await positionEntryValue(u1)), 0.005);
        assert.equal(fromWad(await perpetual.maintenanceMargin.call(u1)), 0.00025);
        assert.equal(fromWad(await perpetual.availableMargin.call(u1)), 10000 - 0.00005 - 0.0005);

        assert.equal(fromWad(await cashBalanceOf(u2)), 10000 - 0.00005);
        assert.equal(await positionSide(u2), LONG);
        assert.equal(fromWad(await positionEntryValue(u2)), 0.005);
        assert.equal(fromWad(await perpetual.maintenanceMargin.call(u2)), 0.00025);
        assert.equal(fromWad(await perpetual.availableMargin.call(u2)), 10000 - 0.00005 - 0.0005);

        assert.equal(fromWad(await positionSize(admin)), 0);
        assert.equal(fromWad(await cashBalanceOf(dev)), 0.00005 * 2);
    });

    describe("case review", async () => {
        beforeEach(async () => {
            await perpetual.setGovernanceAddress(toBytes32("amm"), amm.address);
        });

        it("inversePosition0409", async () => {
            await perpetual.setGovernanceParameter(toBytes32("takerDevFeeRate"), toWad(0));
            await perpetual.setGovernanceParameter(toBytes32("makerDevFeeRate"), toWad(0));

            await setIndexPrice('0.005853985933606647');
            await perpetual.forceSetTotalSize(toWad(9710));
            await perpetual.forceSetPosition(u2, {
                cashBalance: toWad('0.203502974381583502'),
                side: SHORT,
                size: toWad('10'),
                entryValue: toWad('0.05847953216374269'),
                entrySocialLoss: toWad('0'),
                entryFundingLoss: toWad('0.00016654645771424'),
            });
            await perpetual.forceSetPosition(u3, {
                cashBalance: toWad('9999.985367565750491063'),
                side: LONG,
                size: toWad('1990'),
                entryValue: toWad('11.563512253351256565'),
                entrySocialLoss: toWad('0'),
                entryFundingLoss: toWad('0.03419134483667053'),
            });

            await amm.forceSetFunding({
                lastFundingTime: Math.floor(Date.now() / 1000) - 60,
                lastPremium: toWad('0.000008166798236978'),
                lastEMAPremium: toWad('0.000015886645163472'),
                lastIndexPrice: toWad('0.005853985933606647'),
                accumulatedFundingPerContract: toWad('0.000016827253526872'),
            })

            const takerParam = {
                trader: u2,
                amount: 1000,
                price: 170,
                version: 2,
                side: 'sell',
                type: 'limit',
                expiredAtSeconds: 86400,
                makerFeeRate: 25,
                takerFeeRate: 75,
                salt: 1,
                inversed: true,
            };

            const makerParam1 = {
                trader: u3,
                amount: 200,
                price: 170.6,
                version: 2,
                side: 'buy',
                type: 'limit',
                expiredAtSeconds: 86400,
                makerFeeRate: 25,
                takerFeeRate: 75,
                salt: 2,
                inversed: true,
            };
            const makerParam2 = {
                trader: u3,
                amount: 120,
                price: 170.5,
                version: 2,
                side: 'buy',
                type: 'limit',
                expiredAtSeconds: 86400,
                makerFeeRate: 25,
                takerFeeRate: 75,
                salt: 3,
                inversed: true,
            };

            await exchange.matchOrders(
                await buildOrder(takerParam, perpetual.address, admin),
                [
                    await buildOrder(makerParam1, perpetual.address, admin),
                    await buildOrder(makerParam2, perpetual.address, admin)
                ],
                perpetual.address,
                [
                    toWad(200),
                    toWad(120)
                ]
            );
        });
    });
});
