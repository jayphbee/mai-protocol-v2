const assert = require('assert');
const BigNumber = require('bignumber.js');
const { increaseEvmBlock, increaseEvmTime, createEVMSnapshot, restoreEVMSnapshot, startMiner, stopMiner } = require('./funcs');
const { toBytes32, sleep } = require('./funcs');
const { toWei, fromWei, toWad, fromWad, infinity, Side } = require('./constants');

const TestToken = artifacts.require('test/TestToken.sol');
const PriceFeeder = artifacts.require('test/TestPriceFeeder.sol');
const GlobalConfig = artifacts.require('perpetual/GlobalConfig.sol');
const Perpetual = artifacts.require('perpetual/Perpetual.sol');
const AMM = artifacts.require('perpetual/AMM.sol');
const Proxy = artifacts.require('proxy/Proxy.sol');

const gasLimit = 8000000;

contract('one block', accounts => {
    let priceFeeder;
    let collateral;
    let globalConfig;
    let perpetual;
    let proxy;
    let amm;

    const broker = accounts[9];
    const admin = accounts[0];
    const dev = accounts[1];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    const users = {
        broker,
        admin,
        dev,
        u1,
        u2,
        u3,
    };

    let snapshotId;

    const increaseBlockBy = async (n) => {
        for (let i = 0; i < n; i++) {
            await increaseEvmBlock();
        }
    };

    const deploy = async () => {
        priceFeeder = await PriceFeeder.new();
        collateral = await TestToken.new("TT", "TestToken", 18);
        globalConfig = await GlobalConfig.new();
        perpetual = await Perpetual.new(
            globalConfig.address,
            dev,
            collateral.address,
            18
        );
        proxy = await Proxy.new(perpetual.address);
        amm = await AMM.new(globalConfig.address, proxy.address, priceFeeder.address);
        await perpetual.setGovernanceAddress(toBytes32("amm"), amm.address);
        await globalConfig.addComponent(perpetual.address, proxy.address);
    };

    const useDefaultGovParameters = async () => {
        await perpetual.setGovernanceParameter(toBytes32("initialMarginRate"), toWad(0.1));
        await perpetual.setGovernanceParameter(toBytes32("maintenanceMarginRate"), toWad(0.05));
        await perpetual.setGovernanceParameter(toBytes32("liquidationPenaltyRate"), toWad(0.005));
        await perpetual.setGovernanceParameter(toBytes32("penaltyFundRate"), toWad(0.005));
        await perpetual.setGovernanceParameter(toBytes32("takerDevFeeRate"), toWad(0.01));
        await perpetual.setGovernanceParameter(toBytes32("makerDevFeeRate"), toWad(0.01));
        await perpetual.setGovernanceParameter(toBytes32("lotSize"), 1);
        await perpetual.setGovernanceParameter(toBytes32("tradingLotSize"), 1);
    };

    const usePoolDefaultParameters = async () => {
        await amm.setGovernanceParameter(toBytes32("poolFeeRate"), toWad(0.01));
        await amm.setGovernanceParameter(toBytes32("poolDevFeeRate"), toWad(0.005));
        await amm.setGovernanceParameter(toBytes32("updatePremiumPrize"), toWad(1));
        await amm.setGovernanceParameter(toBytes32('emaAlpha'), '3327787021630616'); // 2 / (600 + 1)
        await amm.setGovernanceParameter(toBytes32('markPremiumLimit'), toWad(0.005));
        await amm.setGovernanceParameter(toBytes32('fundingDampener'), toWad(0.0005));
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
        snapshotId = await createEVMSnapshot();
        await deploy();
        await useDefaultGovParameters();
        await usePoolDefaultParameters();
    });

    afterEach(async function () {
        await restoreEVMSnapshot(snapshotId);
    });

    describe("AMM: one block transactions", async () => {
        beforeEach(async () => {
            // index
            await priceFeeder.setPrice(toWad(7000));

            // approve
            await collateral.transfer(u1, toWad(7000 * 100 * 2.1));
            await collateral.transfer(u2, toWad(7000 * 3));
            await collateral.transfer(u3, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, { from: u1 });
            await collateral.approve(perpetual.address, infinity, { from: u2 });
            await collateral.approve(perpetual.address, infinity, { from: u3 });

            // create amm
            await perpetual.deposit(toWad(7000 * 100 * 2.1), { from: u1 });
            await amm.createPool(toWad(100), { from: u1 });
        });


        // TODO: what about the exchange interfaces?

        it("index updated between 2 trades", async () => {
            await perpetual.deposit(toWad(1000), { from: u2 });

            await stopMiner();
            await sleep(500);
            const blockNumber1 = await web3.eth.getBlockNumber();
            var batch = new web3.BatchRequest();

            batch.add(amm.contract.methods.buy(toWad(0.5), toWad('10000'), infinity).send.request({ from: u2, gasLimit: 1500000, gasPrice: 20e9 }));
            batch.add(priceFeeder.contract.methods.setPrice(toWad(6900)).send.request({ from: admin, gasLimit: 500000, gasPrice: 15e9 }));
            batch.add(amm.contract.methods.buy(toWad(0.5), toWad('10000'), infinity).send.request({ from: u2, gasLimit: 1500000, gasPrice: 10e9 }));

            batch.execute();
            await sleep(500);
            await startMiner();
            const blockNumber2 = await web3.eth.getBlockNumber();
            assert.equal(blockNumber2, blockNumber1 + 1, 'the above tx should be in the same block');

            // await inspect(u1);
            // await inspect(u2);
            // await inspect(proxy.address);
            // await printFunding();

            const fundingState = await amm.lastFundingState();
            assert.equal(fromWad(await fundingState.lastIndexPrice), 6900);
        });

        it("index updated before liquidate", async () => {
            await perpetual.deposit(toWad(1000), { from: u2 });
            await perpetual.deposit(toWad(1000), { from: u3 });

            await stopMiner();
            await sleep(500);
            const blockNumber1 = await web3.eth.getBlockNumber();
            var batch = new web3.BatchRequest();

            batch.add(amm.contract.methods.buy(toWad(1), toWad('10000'), infinity).send.request({ from: u2, gasLimit: 1500000, gasPrice: 20e9 }));
            batch.add(priceFeeder.contract.methods.setPrice(toWad(6400)).send.request({ from: admin, gasLimit: 500000, gasPrice: 15e9 }));
            batch.add(perpetual.contract.methods.liquidate(u2, toWad(0.4)).send.request({ from: u3, gasLimit: 1500000, gasPrice: 10e9 }));

            batch.execute();
            await sleep(500);
            await startMiner();
            const blockNumber2 = await web3.eth.getBlockNumber();
            assert.equal(blockNumber2, blockNumber1 + 1, 'the above tx should be in the same block');

            // await inspect(u2);
            // await printFunding();

            // markPrice = 6400 + (small EMA stuff)
            assert.equal(fromWad(await positionSize(u3)), 0.4);
            assert.ok(new BigNumber(await positionEntryValue(u3)).gte(toWad(6400 * 0.4)), "liquidate markPrice should be about 6400");
            assert.ok(new BigNumber(await positionEntryValue(u3)).lte(toWad(6440 * 0.4)), "liquidate markPrice should be about 6400");
        });

    });

});