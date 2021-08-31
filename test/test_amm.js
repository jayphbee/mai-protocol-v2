const assert = require('assert');
const BigNumber = require('bignumber.js');
const {
    increaseEvmBlock,
    increaseEvmTime,
    createEVMSnapshot,
    restoreEVMSnapshot,
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
const GlobalConfig = artifacts.require('global/GlobalConfig.sol');
const Perpetual = artifacts.require('test/TestPerpetual.sol');
const AMM = artifacts.require('test/TestAMM.sol');
const Proxy = artifacts.require('proxy/Proxy.sol');

const gasLimit = 8000000;

contract('amm', accounts => {
    let priceFeeder;
    let collateral;
    let globalConfig;
    let perpetual;
    let proxy;
    let amm;
    let share;

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

    const setIndexPrice = async price => {
        await priceFeeder.setPrice(toWad(price));
        // priceFeeder will modify index.timestamp, amm.timestamp should >= index.timestamp
        const index = await amm.indexPrice();
        await amm.setBlockTimestamp(index.timestamp);
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

    const positionEntryFundingLoss = async (user) => {
        const positionAccount = await perpetual.getMarginAccount(user);
        return positionAccount.entryFundingLoss;
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

    describe("exceptions", async () => {
        it("indexPrice", async () => {
            await priceFeeder.setPrice(0);
            try {
                await amm.indexPrice();
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("dangerous index price"));
            }
        });

        it("empty pool", async () => {
            await priceFeeder.setPrice(toWad(6000));
            try {
                await amm.buy(toWad(1), toWad(10000), infinity);
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("empty pool"), error);
            }
            try {
                await amm.sell(toWad(1), toWad(0), infinity);
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("empty pool"), error);
            }
        });

        it("empty pool", async () => {
            await setIndexPrice(7000);
            const indexPrice = await amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await collateral.transfer(u2, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, { from: u2 });
            await increaseBlockBy(4);

            await perpetual.deposit(toWad(7000 * 3), { from: u2 });
            try {
                await amm.addLiquidity(toWad(1), { from: u2 });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("empty pool"), error);
            }
        });

        it("empty pool", async () => {
            await setIndexPrice(7000);
            const indexPrice = await amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await collateral.transfer(u2, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, { from: u2 });
            await increaseBlockBy(4);

            await perpetual.deposit(toWad(7000 * 3), { from: u2 });
            try {
                await amm.removeLiquidity(toWad(1), { from: u2 });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("empty pool"), error);
            }
        });

        it("wrong perpetual status", async () => {
            try {
                await amm.settleShare({ from: u2 });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("wrong perpetual status"), error);
            }
        });
    });

    describe("composed interface", async () => {
        beforeEach(async () => {
            await setIndexPrice(7000);
            const indexPrice = await amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await collateral.transfer(u2, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, { from: u2 });
        })

        it("depositAndBuy", async () => {
            await amm.depositAndBuy(toWad(1), toWad(0), toWad("10000"), infinity, { from: u2 });
            assert.equal(await cashBalanceOf(u2), toWad(1));
        });

        it("depositAndSell", async () => {
            await amm.depositAndSell(toWad(0), toWad(0), toWad("0"), infinity, { from: u2 });
            await amm.depositAndSell(toWad(1), toWad(0), toWad("0"), infinity, { from: u2 });
            assert.equal(await cashBalanceOf(u2), toWad(1));
        });
    });

    describe("availableMargin", async () => {
        beforeEach(async () => {
            await amm.setGovernanceParameter(toBytes32("poolFeeRate"), toWad(0));
            await amm.setGovernanceParameter(toBytes32("poolDevFeeRate"), toWad(0));

            // index
            await setIndexPrice(7000);
            const indexPrice = await amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await collateral.transfer(u1, toWad(7000 * 100 * 2.1));
            await collateral.transfer(u2, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, {
                from: u1
            });
            await collateral.approve(perpetual.address, infinity, {
                from: u2
            });

            // create amm
            assertApproximate(assert, fromWad(await amm.currentAvailableMargin.call()), 0); // amm.x
            await amm.setAccumulatedFundingPerContract(toWad(50));
            await perpetual.deposit(toWad(7000 * 100 * 2.1), {
                from: u1
            });
            await amm.createPool(toWad(100), {
                from: u1
            });

            // u2 deposit
            await perpetual.deposit(toWad(7000 * 3), {
                from: u2
            });
        });

        it("without loss", async () => {
            // await inspect(proxy.address);
            assertApproximate(assert, fromWad(await amm.currentAvailableMargin.call()), 700000); // amm.x
        });
    });

    describe("create amm", async () => {
        beforeEach(async () => {
            // index
            await setIndexPrice(7000);
            const indexPrice = await amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await collateral.transfer(u1, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, {
                from: u1
            });
        });

        it('spend: no marginBalance', async () => {
            try {
                await amm.createPool(toWad(1), {
                    from: u1
                });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("im unsafe"), error);
            }
        });

        it('should success', async () => {
            await perpetual.deposit(toWad(7000 * 2.1), {
                from: u1
            });
            await amm.createPool(toWad(1), {
                from: u1
            });

            // await inspect(u1);
            // await inspect(proxy.address);
            // await printFunding();

            // position
            assert.equal(fromWad(await amm.positionSize()), 1);
            assert.equal(fromWad(await amm.currentAvailableMargin.call()), 7000 * 1);
            assert.equal(fromWad(await positionSize(u1)), 1);
            assert.equal(fromWad(await positionSize(proxy.address)), 1); // amm.y
            assert.equal(await positionSide(u1), Side.SHORT);
            assert.equal(await positionSide(proxy.address), Side.LONG);

            // perpetual
            assert.equal(await perpetual.isSafe.call(u1), true);
            assert.equal(await perpetual.isSafe.call(proxy.address), true);
            assert.equal(await perpetual.isBankrupt.call(u1), false);
            assert.equal(await perpetual.isBankrupt.call(proxy.address), false);
            assert.equal(fromWad(await perpetual.availableMargin.call(u1)), 0);
            assert.equal(fromWad(await perpetual.availableMargin.call(proxy.address)), 7000 * 2 - 7000 * 0.1); // amm.x
            assert.equal(fromWad(await perpetual.pnl.call(u1)), 0);
            assert.equal(fromWad(await perpetual.pnl.call(proxy.address)), 0);
            assert.equal(fromWad(await cashBalanceOf(u1)), 7000 * 0.1);
            assert.equal(fromWad(await cashBalanceOf(proxy.address)), 7000 * 2);
            assert.equal(fromWad(await positionEntryValue(u1)), 7000);
            assert.equal(fromWad(await positionEntryValue(proxy.address)), 7000);
            assert.equal(fromWad(await perpetual.positionMargin.call(u1)), 700);
            assert.equal(fromWad(await perpetual.positionMargin.call(proxy.address)), 700);
            assert.equal(fromWad(await perpetual.maintenanceMargin.call(u1)), 350);
            assert.equal(fromWad(await perpetual.maintenanceMargin.call(proxy.address)), 350);

            // funding
            const fundingState = await amm.currentFundingState.call();
            assert.equal(fromWad(await amm.currentFairPrice.call()), 7000);
            assert.equal(fromWad(await amm.currentPremium.call()), 0);
            assert.equal(fromWad(await amm.currentMarkPrice.call()), 7000);
            assert.equal(fromWad(await amm.currentPremiumRate.call()), 0);
            assert.equal(fromWad(await amm.currentFundingRate.call()), 0);
            assert.equal(fromWad(fundingState.lastIndexPrice), 7000);
            assert.equal(fromWad(fundingState.lastEMAPremium), 0);
            assert.equal(fromWad(fundingState.lastPremium), 0);
            assert.equal(fromWad(fundingState.accumulatedFundingPerContract), 0);
        });

        it('duplicated', async () => {
            await perpetual.deposit(toWad(7000 * 2.1), {
                from: u1
            });
            await amm.createPool(toWad(1), {
                from: u1
            });
            try {
                await amm.createPool(toWad(1), {
                    from: u1
                });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("pool not empty"), error);
            }
        });
    });

    describe("trading", async () => {
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
            await increaseBlockBy(4);

            // create amm
            await perpetual.deposit(toWad(7000 * 10 * 2.1), {
                from: u1
            });
            await amm.createPool(toWad(10), {
                from: u1
            });
        });

        // TODO: buy - success - amount is very close to amm.positionSize
        // TODO: buy - fail - amount >= amm.positionSize

        it("buy - fail - price limit", async () => {
            // 70000 / (10 - 1) = 7777.7
            await perpetual.deposit(toWad(7000), {
                from: u2
            });
            try {
                await amm.buy(toWad(1), toWad(7777), infinity, {
                    from: u2
                });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("price limited"), error);
            }
            await amm.buy(toWad(1), toWad(7778), infinity, {
                from: u2
            });
        });

        it("buy - success - pnl < 0, critical deposit amount", async () => {
            // buy 0.1, entryPrice will be 70000 / (10 - 0.1) = 7070 but markPrice is still 7000
            // deposit = positionMargin + fee - pnl
            // = markPrice * newPos * IMR + tradePrice * newPos * fee - (markPrice - newEntryPrice) * newPos
            await perpetual.deposit(toWad('87.67676767676767677'), { from: u2 });
            await amm.buy(toWad(0.1), toWad('10000'), infinity, { from: u2 });
            assert.equal((await cashBalanceOf(u2)).toString(), "77070707070707070709");
        });

        it("buy withdraw 0", async () => {
            await perpetual.deposit(toWad('87.67676767676767677'), { from: u2 });
            await amm.buyAndWithdraw(toWad(0.1), toWad('10000'), infinity, 0, { from: u2 });
            // console.log((await perpetual.availableMargin.call(u2)).toString());
            assert.equal((await cashBalanceOf(u2)).toString(), "77070707070707070709");
        });

        it("buy - withdraw", async () => {
            await perpetual.deposit(toWad('88.67676767676767677'), { from: u2 });
            await amm.buyAndWithdraw(toWad(0.1), toWad('10000'), infinity, toWad("1"), { from: u2 });
            // console.log((await perpetual.availableMargin.call(u2)).toString());
            assert.equal((await cashBalanceOf(u2)).toString(), "70000000000000000001");
        });

        it("buy - fail - pnl < 0, lower than critical deposit amount", async () => {
            await perpetual.deposit(toWad('87.67676767676767676'), {
                from: u2
            });
            try {
                await amm.buy(toWad(0.1), toWad('10000'), infinity, {
                    from: u2
                });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("im unsafe"), error);
            }
        });

        it("buy - fail - deadline", async () => {
            await perpetual.deposit(toWad(7000 * 1), {
                from: u2
            });

            const t1 = (await amm.mockBlockTimestamp()).toNumber();
            await amm.setBlockTimestamp(t1 + 600);
            try {
                await amm.buy(toWad(1), toWad('10000'), t1 + 100, {
                    from: u2
                });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("deadline"), error);
            }
        });

        it("sell - fail - price unsafe", async () => {
            await perpetual.deposit(toWad(7000 * 0.1), {
                from: u2
            });
            try {
                await amm.sell(toWad(1), toWad(0), infinity, {
                    from: u2
                });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("im unsafe"), error);
            }
        });

        it("sell - fail - price limit", async () => {
            // 70000 / (10 + 1) = 6363.6
            await perpetual.deposit(toWad(7000), {
                from: u2
            });
            try {
                await amm.sell(toWad(1), toWad(6364), infinity, {
                    from: u2
                });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("price limited"), error);
            }
            await amm.sell(toWad(1), toWad(6363), infinity, {
                from: u2
            });
        });

    describe("funding", async () => {
        beforeEach(async () => {
            // index
            await setIndexPrice(7000);
            const indexPrice = await amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await collateral.transfer(u1, toWad(7000 * 100 * 2.1));
            await collateral.transfer(u2, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, {
                from: u1
            });
            await collateral.approve(perpetual.address, infinity, {
                from: u2
            });

            // create amm
            await perpetual.deposit(toWad(7000 * 100 * 2.1), {
                from: u1
            });
            await amm.createPool(toWad(100), {
                from: u1
            });
        });

        it("user buys => price increases (above the limit) => long position pays for fundingLoss", async () => {
            await perpetual.deposit(toWad(1000), {
                from: u2
            });

            // trading price = 7035
            // assert.equal(fromWad(await amm.getBuyPrice.call(toWad(0.5))), '7035.175879396984924623');
            await amm.buy(toWad(0.5), toWad('10000'), infinity, {
                from: u2
            });

            // await inspect(u1);
            // await inspect(u2);
            // await inspect(proxy.address);
            // await printFunding();

            assert.equal(fromWad(await amm.positionSize()), 99.5);
            assert.equal(fromWad(await positionSize(proxy.address)), 99.5);
            assert.equal(fromWad(await positionSize(u1)), 100);
            assert.equal(fromWad(await positionSize(u2)), 0.5);
            assert.equal(await positionSide(proxy.address), Side.LONG);
            assert.equal(await positionSide(u1), Side.SHORT);
            assert.equal(await positionSide(u2), Side.LONG);
            assert.equal(fromWad(await positionEntryFundingLoss(u2)), 0);
            assertApproximate(assert, fromWad(await cashBalanceOf(proxy.address)), '1400052.763819095477386935');
            assert.equal(fromWad(await positionEntryValue(proxy.address)), '696500');
            assertApproximate(assert, fromWad(await amm.currentAvailableMargin.call()), '703552.763819095477386935'); // amm.x
            assertApproximate(assert, fromWad(await amm.currentFairPrice.call()), '7070.882048433120375748');

            // now fairPrice = 7070, indexPrice = 7000
            assert.equal(fromWad(await amm.currentFundingRate.call()), '0'); // hard limit
            assert.equal(fromWad(await amm.currentMarkPrice.call()), '7000');

            // t = 0, markPrice = 7000, entryPrice = 7035, funding = 0, u2.pnl = (7000 - 7035) * amount = -17
            assertApproximate(assert, fromWad(await positionEntryValue(u2)), '3517.587939698492462311');
            assertApproximate(assert, fromWad(await perpetual.pnl.call(u2)), '-17.587939698492462311');

            // t = 600, markPrice = 7061, entryPrice = 7035, funding = 0, u2.pnl = (7061 - 7035) * amount + funding
            await amm.setBlockTimestamp((await amm.mockBlockTimestamp()).toNumber() + 600);

            assert.equal(fromWad(await amm.currentFundingRate.call()), '0.0045'); // hard limit
            assertApproximate(assert, fromWad(await amm.currentMarkPrice.call()), '7035');
            assertApproximate(assert, fromWad(await amm.currentAccumulatedFundingPerContract.call()), '0.546491210154512945');
            assertApproximate(assert, fromWad(await perpetual.pnl.call(u2)), '-0.361185303569718784');

            // await inspect(u2);
            // await printFunding();
        });

        it("user buys => price increases (below the limit) => long position pays for fundingLoss", async () => {
            await perpetual.deposit(toWad(1000), {
                from: u2
            });

            // trading price = 7007
            // assert.equal(fromWad(await amm.getBuyPrice.call(toWad(0.1))), '7007.007007007007007007');
            await amm.buy(toWad(0.1), toWad('10000'), infinity, {
                from: u2
            });

            // await inspect(u1);
            // await inspect(u2);
            // await inspect(proxy.address);
            // await printFunding();

            assertApproximate(assert, fromWad(await amm.currentFairPrice.call()), '7014.091168245322399477');

            // now fairPrice = 7014, indexPrice = 7000
            assert.equal(fromWad(await amm.currentFundingRate.call()), '0');
            assert.equal(fromWad(await amm.currentMarkPrice.call()), '7000');

            // t = 0
            assertApproximate(assert, fromWad(await positionEntryValue(u2)), '700.700700700700700701');
            assertApproximate(assert, fromWad(await perpetual.pnl.call(u2)), '-0.700700700700700701');

            // t = 600
            await amm.setBlockTimestamp((await amm.mockBlockTimestamp()).toNumber() + 600);
            assert.equal(fromWad(await amm.currentFundingRate.call()), '0.001240591361607249');
            assertApproximate(assert, fromWad(await amm.currentMarkPrice.call()), '7012.184139531250741823');
            assertApproximate(assert, fromWad(await amm.currentAccumulatedFundingPerContract.call()), '0.098538196067897057');
            assertApproximate(assert, fromWad(await perpetual.pnl.call(u2)), '0.507859432817583779');

            // await inspect(u2);
            // await printFunding();
        });

        it("consumed gas", async () => {
            await amm.setBlockTimestamp((await amm.mockBlockTimestamp()).toNumber() + 15);
            console.log("estimateGas 15s:", await amm.fundingPublic.estimateGas());
            await amm.setBlockTimestamp((await amm.mockBlockTimestamp()).toNumber() + 600);
            console.log("estimateGas 10m:", await amm.fundingPublic.estimateGas());
            await amm.setBlockTimestamp((await amm.mockBlockTimestamp()).toNumber() + 86400);
            console.log("estimateGas 1d:", await amm.fundingPublic.estimateGas());
            await amm.setBlockTimestamp((await amm.mockBlockTimestamp()).toNumber() + 86400 * 365);
            console.log("estimateGas 1y:", await amm.fundingPublic.estimateGas());
        });
    });

    describe("composite helper", async () => {
        beforeEach(async () => {
            // index
            await setIndexPrice(7000);
            const indexPrice = await amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await collateral.transfer(u1, toWad(7000 * 10 * 2.1));
            await collateral.transfer(u2, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, {
                from: u1
            });
            await collateral.approve(perpetual.address, infinity, {
                from: u2
            });

            // create amm
            await perpetual.deposit(toWad(7000 * 10 * 2.1), {
                from: u1
            });
            await amm.createPool(toWad(10), {
                from: u1
            });
        });

        it("depositAndBuy - success", async () => {
            await amm.depositAndBuy(toWad(7000 * 1), toWad(1), toWad('10000'), infinity, {
                from: u2
            });

            assert.equal(fromWad(await amm.positionSize()), 9);
            assert.equal(fromWad(await positionSize(proxy.address)), 9);
            assert.equal(fromWad(await positionSize(u1)), 10);
            assert.equal(fromWad(await positionSize(u2)), 1);
            assert.equal(await positionSide(proxy.address), Side.LONG);
            assert.equal(await positionSide(u1), Side.SHORT);
            assert.equal(await positionSide(u2), Side.LONG);

            assert.equal(fromWad(await cashBalanceOf(u2)), '6883.333333333333333333');
            assert.equal(fromWad(await share.balanceOf(u2)), 0);
            assert.equal(fromWad(await positionEntryValue(u2)), '7777.777777777777777778'); // trade price * position
            assert.equal(fromWad(await perpetual.pnl.call(u2)), '-777.777777777777777779');

            assert.equal(fromWad(await amm.currentAvailableMargin.call()), '77855.555555555555555555'); // amm.x
            assert.equal(fromWad(await cashBalanceOf(proxy.address)), '140855.555555555555555555');
            assert.equal(fromWad(await positionEntryValue(proxy.address)), '63000');
            assert.equal(fromWad(await amm.currentFairPrice.call()), '8650.617283950617283951');
        });

        it("depositAndBuy, deposit = $0 - success", async () => {
            await perpetual.deposit(toWad(7000 * 1), { from: u2 });
            assert.equal(fromWad(await cashBalanceOf(u2)), 7000 * 1);
            assert.equal(fromWad(await positionSize(u2)), 0);

            await amm.depositAndBuy('0', toWad(1), toWad('10000'), infinity, { from: u2 });
            assert.equal(fromWad(await cashBalanceOf(u2)), '6883.333333333333333333');
            assert.equal(fromWad(await positionSize(u2)), 1);
        });

        it("depositAndSell - success", async () => {
            await amm.depositAndSell(toWad(2000), toWad(1), toWad(0), infinity, {
                from: u2
            });

            assert.equal(fromWad(await amm.positionSize()), 11);
            assert.equal(fromWad(await positionSize(proxy.address)), 11);
            assert.equal(fromWad(await positionSize(u1)), 10);
            assert.equal(fromWad(await positionSize(u2)), 1);
            assert.equal(await positionSide(proxy.address), Side.LONG);
            assert.equal(await positionSide(u1), Side.SHORT);
            assert.equal(await positionSide(u2), Side.SHORT);

            assert.equal(fromWad(await cashBalanceOf(u2)), '1904.545454545454545454');
            assert.equal(fromWad(await share.balanceOf(u2)), 0);
            assert.equal(fromWad(await positionEntryValue(u2)), '6363.636363636363636364'); // trade price * position
            assert.equal(fromWad(await perpetual.pnl.call(u2)), '-636.363636363636363637');

            assert.equal(fromWad(await amm.currentAvailableMargin.call()), 63700); // amm.x
            assert.equal(fromWad(await cashBalanceOf(proxy.address)), '140063.636363636363636364');
            assert.equal(fromWad(await positionEntryValue(proxy.address)), '76363.636363636363636364');
            assert.equal(fromWad(await amm.currentFairPrice.call()), '5790.909090909090909091');
        });

        it("depositAndAddLiquidity - success", async () => {

            await amm.depositAndAddLiquidity(toWad(0), toWad(0), { from: u2 });
            await amm.depositAndAddLiquidity(toWad(7000 * 3), toWad(1), { from: u2 });

            assert.equal(fromWad(await cashBalanceOf(u2)), 7000);
            assert.equal(fromWad(await share.balanceOf(u2)), 1);
            assert.equal(fromWad(await positionSize(u2)), 1);
            assert.equal(await positionSide(u2), Side.SHORT);
            assert.equal(fromWad(await positionEntryValue(u2)), 7000);

            assert.equal(fromWad(await cashBalanceOf(proxy.address)), 154000); // 7000 * 2 * 10 when createPool + 7000 * 2 this time
            assert.equal(fromWad(await positionSize(proxy.address)), 11);
            assert.equal(await positionSide(proxy.address), Side.LONG);
            assert.equal(fromWad(await positionEntryValue(proxy.address)), 77000);
        });
    });

    describe("inverse contract", async () => {
        beforeEach(async () => {
            // index
            await setIndexPrice(1 / 200);

            // approve
            await collateral.transfer(u1, toWad(1 / 200 * 20000 * 2.1));
            await collateral.transfer(u2, toWad(1 / 200 * 200));
            await collateral.approve(perpetual.address, infinity, {
                from: u1
            });
            await collateral.approve(perpetual.address, infinity, {
                from: u2
            });

            // create amm
            await perpetual.deposit(toWad(1 / 200 * 20000 * 2.1), {
                from: u1
            });
            await amm.createPool(toWad(200), {
                from: u1
            });
        });

        it("depositAndBuy - success", async () => {
            await amm.depositAndBuy(toWad(1 / 200 * 1), toWad(1), toWad(1), infinity, {
                from: u2
            });
            assert.equal(fromWad(await amm.positionSize()), 199);
            assert.equal(fromWad(await positionSize(u2)), 1);
        });

        it("buyAndWithdraw - success", async () => {
            await amm.depositAndBuy(toWad(1 / 200 * 1), toWad(1), toWad(1), infinity, {
                from: u2
            });
            assert.equal(fromWad(await amm.positionSize()), 199);
            assert.equal(fromWad(await positionSize(u2)), 1);
            // await inspect(u2)

            await amm.sellAndWithdraw(toWad(0), toWad(0), infinity, 0, { from: u2 });
            await amm.sellAndWithdraw(toWad(1), toWad(0), infinity, toWad('0.004849493718592963'), { from: u2 });
            // await inspect(u2)
            assert.equal(fromWad(await amm.positionSize()), 200);
            assert.equal(fromWad(await positionSize(u2)), 0);
        });
    });

    describe("settle", async () => {
        beforeEach(async () => {
            // index
            await setIndexPrice(7000);
            const indexPrice = await amm.indexPrice();
            assert.equal(fromWad(indexPrice.price), 7000);

            // approve
            await collateral.transfer(u1, toWad(7000 * 100 * 2.1));
            await collateral.transfer(u2, toWad(7000 * 3));
            await collateral.approve(perpetual.address, infinity, {
                from: u1
            });
            await collateral.approve(perpetual.address, infinity, {
                from: u2
            });
            // create amm
            await perpetual.deposit(toWad(7000 * 100 * 2.1), {
                from: u1
            });
            await amm.createPool(toWad(100), {
                from: u1
            });
        });

        // this case is similar to "user buys => price increases (below the limit) => long position pays for fundingLoss"
        it("funding freeze after settling", async () => {
            await perpetual.deposit(toWad(1000), {
                from: u2
            });

            // trading price = 7007
            // assert.equal(fromWad(await amm.getBuyPrice.call(toWad(0.1))), '7007.007007007007007007');
            await amm.buy(toWad(0.1), toWad('10000'), infinity, {
                from: u2
            });

            // await inspect(u1);
            // await inspect(u2);
            // await inspect(proxy.address);
            // await printFunding();

            assertApproximate(assert, fromWad(await amm.currentFairPrice.call()), '7014.091168245322399477');

            // now fairPrice = 7014, indexPrice = 7000
            assert.equal(fromWad(await amm.currentFundingRate.call()), '0');
            assert.equal(fromWad(await amm.currentMarkPrice.call()), '7000');

            // t = 0
            assertApproximate(assert, fromWad(await positionEntryValue(u2)), '700.700700700700700701');
            assertApproximate(assert, fromWad(await perpetual.pnl.call(u2)), '-0.700700700700700701');

            await perpetual.beginGlobalSettlement(toWad(7000));

            // t = 600
            await amm.setBlockTimestamp((await amm.mockBlockTimestamp()).toNumber() + 600);
            assert.equal(fromWad(await amm.currentFundingRate.call()), '0');
            assertApproximate(assert, fromWad(await amm.currentMarkPrice.call()), '7000');
            assertApproximate(assert, fromWad(await amm.currentAccumulatedFundingPerContract.call()), '0');
            assertApproximate(assert, fromWad(await perpetual.pnl.call(u2)), '-0.700700700700700701');

            await amm.setGovernanceParameter(toBytes32("accumulatedFundingPerContract"), toWad(-0.1));
            assertApproximate(assert, fromWad(await amm.currentAccumulatedFundingPerContract.call()), '-0.1');
            assertApproximate(assert, fromWad(await perpetual.pnl.call(u2)), '-0.690700700700700701');

            // await inspect(u2);
            // await printFunding();
        });
    });
});