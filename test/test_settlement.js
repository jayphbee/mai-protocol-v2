const assert = require('assert');
const BigNumber = require('bignumber.js');
const {
    increaseEvmBlock,
    increaseEvmTime,
    createEVMSnapshot,
    toBytes32,
    assertApproximate
} = require('./funcs');
const {
    toWei,
    fromWei,
    toWad,
    fromWad,
    infinity,
    Side
} = require('./constants');

const TestToken = artifacts.require('test/TestToken.sol');
const PriceFeeder = artifacts.require('test/TestPriceFeeder.sol');
const GlobalConfig = artifacts.require('perpetual/GlobalConfig.sol');
const Perpetual = artifacts.require('test/TestPerpetual.sol');
const AMM = artifacts.require('test/TestAMM.sol');
const Proxy = artifacts.require('proxy/Proxy.sol');

const gasLimit = 8000000;

contract('settlement', accounts => {
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

    const setIndexPrice = async price => {
        await priceFeeder.setPrice(toWad(price));

        // priceFeeder will modify index.timestamp, amm.timestamp should >= index.timestamp
        const index = await amm.indexPrice();
        await amm.setBlockTimestamp(index.timestamp);
    };

    const positionSize = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.size;
    }

    const positionSide = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.side;
    }

    const positionEntryValue = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.entryValue;
    }

    const positionEntryFundingLoss = async (user) => {
        const positionAccount = await perpetual.getPosition(user);
        return positionAccount.entryFundingLoss;
    }
    const cashBalanceOf = async (user) => {
        const cashAccount = await perpetual.getMarginAccount(user);
        return cashAccount.cashBalance;
    }

    beforeEach(async () => {
        await deploy();
        await useDefaultGovParameters();
        await usePoolDefaultParameters();
    });

    beforeEach(async () => {
        // index
        await setIndexPrice(7000);
        const indexPrice = await amm.indexPrice();
        assert.equal(fromWad(indexPrice.price), 7000);

        // approve
        await collateral.transfer(u1, toWad(7000 * 10 * 2.1));
        await collateral.transfer(u2, toWad(7000 * 3));
        await collateral.transfer(u3, toWad(7000 * 3));
        await collateral.transfer(dev, toWad(7000 * 3));
        await collateral.approve(perpetual.address, infinity, {
            from: u1
        });
        await collateral.approve(perpetual.address, infinity, {
            from: u2
        });
        await collateral.approve(perpetual.address, infinity, {
            from: u3
        });
        await collateral.approve(perpetual.address, infinity, {
            from: dev
        });

        // create amm
        await perpetual.deposit(toWad(7000 * 10 * 2.1), {
            from: u1
        });
        await amm.createPool(toWad(10), {
            from: u1
        });

        await globalConfig.addBroker(admin);
        await globalConfig.addComponent(amm.address, admin);
        await globalConfig.addComponent(perpetual.address, admin);
    });


    it("increaseCashBalance", async () => {
        await perpetual.deposit(toWad(7000), {from: u2});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});
``
        try {
            await perpetual.increaseCashBalance(u2, toWad(1));
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"))
        }
    });

    it("decreaseCashBalance", async () => {
        await perpetual.deposit(toWad(7000), {from: u2});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});
``
        try {
            await perpetual.decreaseCashBalance(u2, toWad(1));
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"))
        }
    });

    it("set socialloss on settling", async () => {
        await perpetual.deposit(toWad(7000), {from: u2});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});

        try {
            await perpetual.setGovernanceParameter(toBytes32("longSocialLossPerContracts"), toWad(10000));
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"))
        }

        const pnl = (await  perpetual.pnl.call(u2)).toString();
        await perpetual.beginGlobalSettlement(toWad(7000));
        assert.equal(pnl, (await perpetual.pnl.call(u2)).toString());

        await perpetual.setGovernanceParameter(toBytes32("longSocialLossPerContracts"), toWad(666));
        var newPnl = (await  perpetual.pnl.call(u2)).toString();
        var deltaPnl = (new BigNumber(pnl).minus(new BigNumber(newPnl))).toFixed();
        assert.equal(deltaPnl, toWad(666));


        await perpetual.setGovernanceParameter(toBytes32("longSocialLossPerContracts"), toWad(123.4));
        var newPnl = (await  perpetual.pnl.call(u2)).toString();
        var deltaPnl = (new BigNumber(pnl).minus(new BigNumber(newPnl))).toFixed();
        assert.equal(deltaPnl, toWad(123.4));


        await perpetual.endGlobalSettlement();

        try {
            await perpetual.setGovernanceParameter(toBytes32("longSocialLossPerContracts"), toWad(10000));
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"))
        }

    })

    it("set balance on settling", async () => {
        await perpetual.deposit(toWad(7000), {from: u2});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});

        const token = (await collateral.balanceOf(u2)).toString();
        const total = (await perpetual.marginBalance.call(u2)).toString();
        assert.equal(total, "6105555555555555555554");

        await perpetual.beginGlobalSettlement(toWad(7000));
        await perpetual.endGlobalSettlement();

        await perpetual.settle({from: u2});
        assert.equal((await collateral.balanceOf(u2)).toString(), (new BigNumber(token).plus(new BigNumber(total))).toFixed())
        // console.log((await collateral.balanceOf(u2)).toString());
    })


    it("set balance on settling 2", async () => {
        await perpetual.deposit(toWad(7000), {from: u2});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});

        const token = (await collateral.balanceOf(u2)).toString();
        const total = (await perpetual.marginBalance.call(u2)).toString();
        assert.equal(total, "6105555555555555555554");

        const cash = fromWad((await perpetual.getMarginAccount(u2)).cashBalance);

        await perpetual.beginGlobalSettlement(toWad(7000));
        try {
            await perpetual.increaseCashBalance(u2, toWad(998), {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("not owner"))
        }
        try {
            await perpetual.decreaseCashBalance(u2, toWad(998), {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("not owner"))
        }
        await perpetual.increaseCashBalance(u2, toWad(998));
        await perpetual.endGlobalSettlement();

        await perpetual.settle({from: u2});
        assert.equal((await collateral.balanceOf(u2)).toString(), (new BigNumber(token).plus(new BigNumber(total))).plus(new BigNumber(toWad(998))).toFixed())
        // console.log((await collateral.balanceOf(u2)).toString());
    })

    it("set balance on settling 3", async () => {
        await perpetual.deposit(toWad(7000), {from: u2});

        await perpetual.beginGlobalSettlement(toWad(7000));

        await perpetual.decreaseCashBalance(u2, toWad(2000));
        assert.equal(await cashBalanceOf(u2), toWad(5000));

        await perpetual.increaseCashBalance(u2, toWad(2000));
        assert.equal(await cashBalanceOf(u2), toWad(7000));
    })

    it("settling forbids", async () => {
        await perpetual.deposit(toWad(6000), {from: u2});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});

        await perpetual.beginGlobalSettlement(toWad(6000));

        try {
            await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.buyFromWhitelisted(u2, toWad(1), toWad('10000'), infinity);
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.sell(toWad(1), toWad('0'), infinity, {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.sellFromWhitelisted(u2, toWad(1), toWad('0'), infinity);
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.depositAndBuy(toWad('100'), toWad(1), toWad('10000'), infinity, {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.depositAndSell(toWad('100'), toWad(1), toWad('0'), infinity, {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.addLiquidity(toWad(1), {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.removeLiquidity(toWad(1), {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.createPool(toWad(1), {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await perpetual.withdraw(toWad(1), {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await perpetual.withdrawFor(u2, toWad(1));
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
    });

    it("settling allows", async () => {
        await perpetual.deposit(toWad(6000), {from: u2});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});

        await perpetual.beginGlobalSettlement(toWad(6000));

        await setIndexPrice(5000);
        const allows = [
            perpetual.deposit(toWad(1), {from: u2})
        ]
        for (let i = 0; i < allows.length; i++) {
            await allows[i];
        }
    });

    it("settled forbids", async () => {
        await perpetual.deposit(toWad(6000), {from: u2});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});

        await perpetual.beginGlobalSettlement(toWad(6000));
        await perpetual.endGlobalSettlement();

        try {
            await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.buyFromWhitelisted(u2, toWad(1), toWad('10000'), infinity);
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.sell(toWad(1), toWad('0'), infinity, {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.sellFromWhitelisted(u2, toWad(1), toWad('0'), infinity);
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.depositAndBuy(toWad('100'), toWad(1), toWad('10000'), infinity, {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.depositAndSell(toWad('100'), toWad(1), toWad('0'), infinity, {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.addLiquidity(toWad(1), {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.removeLiquidity(toWad(1), {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
        try {
            await amm.createPool(toWad(1), {from: u2});
            throw null;
        } catch (error) {
            assert.ok(error.message.includes("wrong perpetual status"), error);
        }
    });

    it("settled allows", async () => {
        await perpetual.deposit(toWad(6000), {from: u2});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});

        await perpetual.beginGlobalSettlement(toWad(6000));
        await perpetual.endGlobalSettlement();

        const allows = [
            perpetual.settle({from: u2}),
            amm.settleShare({from: u2}),
        ]
        for (let i = 0; i < allows.length; i++) {
            await allows[i];
        }
    });

    it("settling liquidate", async () => {
        await perpetual.deposit(toWad(2000), {from: u2});
        await perpetual.deposit(toWad(7000), {from: u3});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});

        await perpetual.beginGlobalSettlement(toWad(5000));

        const allows = [
            perpetual.liquidate(u2, toWad(1), {from:u3}),
        ]
        for (let i = 0; i < allows.length; i++) {
            await allows[i];
        }
    });

    it("settled liquidate", async () => {
        await perpetual.deposit(toWad(2000), {from: u2});
        await perpetual.deposit(toWad(7000), {from: u3});
        await amm.buy(toWad(1), toWad('10000'), infinity, {from: u2});

        await perpetual.beginGlobalSettlement(toWad(5000));
        await perpetual.endGlobalSettlement();

        const forbids = [
            perpetual.liquidate(u2, toWad(1), {from:u3}),
        ]
        for (let i = 0; i < forbids.length; i++) {
            try {
                await forbids[i];
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("wrong perpetual status"), i);
            }
        }
    });
});