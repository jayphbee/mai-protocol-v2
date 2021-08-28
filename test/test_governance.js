const assert = require('assert');
const BigNumber = require('bignumber.js');
const { increaseEvmBlock, toBytes32 } = require('./funcs');
const { toWad, fromWad, infinity } = require('./constants');

const TestPerpGovernance = artifacts.require('test/TestPerpGovernance.sol');
const AMMGovernance = artifacts.require('liquidity/AMMGovernance.sol');
const GlobalConfig = artifacts.require('perpetual/GlobalConfig.sol');
const PriceFeeder = artifacts.require('test/TestPriceFeeder.sol');

contract('TestPerpGovernance', accounts => {
    const NORMAL = 0;
    const EMERGENCY = 1;
    const SETTLED = 2;

    let governance;
    let ammGovernance;
    let globalConfig;

    const broker = accounts[9];
    const admin = accounts[0];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    const users = {
        broker,
        admin,
        u1,
        u2,
        u3,
    };

    const deploy = async () => {
        globalConfig = await GlobalConfig.new();
        governance = await TestPerpGovernance.new(globalConfig.address);
        ammGovernance = await AMMGovernance.new(globalConfig.address);

        await useDefaultGovParameters();
        await usePoolDefaultParameters();
    };


    const useDefaultGovParameters = async () => {
        await governance.setGovernanceParameter(toBytes32("initialMarginRate"), toWad(0.1));
        await governance.setGovernanceParameter(toBytes32("maintenanceMarginRate"), toWad(0.05));
        await governance.setGovernanceParameter(toBytes32("liquidationPenaltyRate"), toWad(0.005));
        await governance.setGovernanceParameter(toBytes32("penaltyFundRate"), toWad(0.005));
        await governance.setGovernanceParameter(toBytes32("takerDevFeeRate"), toWad(0.00075));
        await governance.setGovernanceParameter(toBytes32("makerDevFeeRate"), toWad(-0.00025));
        await governance.setGovernanceParameter(toBytes32("lotSize"), 1);
        await governance.setGovernanceParameter(toBytes32("tradingLotSize"), 1);
    };

    const usePoolDefaultParameters = async () => {
        await ammGovernance.setGovernanceParameter(toBytes32("poolFeeRate"), toWad(0.000375));
        await ammGovernance.setGovernanceParameter(toBytes32("poolDevFeeRate"), toWad(0.000375));
        await ammGovernance.setGovernanceParameter(toBytes32("updatePremiumPrize"), toWad(0));
        await ammGovernance.setGovernanceParameter(toBytes32('emaAlpha'), '3327787021630616'); // 2 / (600 + 1)
        await ammGovernance.setGovernanceParameter(toBytes32('markPremiumLimit'), toWad(0.005));
        await ammGovernance.setGovernanceParameter(toBytes32('fundingDampener'), toWad(0.0005));
    };

    describe("exceptions", async () => {
        before(deploy);

        it("setGovernanceParameter exceptions", async () => {
            try {
                await governance.setGovernanceParameter(toBytes32("initialMarginRate"), 0);
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require im > 0"), error);
            }
            try {
                await governance.setGovernanceParameter(toBytes32("initialMarginRate"), toWad(2));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require im < 1"), error);
            }
            try {
                await governance.setGovernanceParameter(toBytes32("initialMarginRate"), toWad(0.05));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require mm < im"), error);
            }
            try {
                await governance.setGovernanceParameter(toBytes32("maintenanceMarginRate"), 0);
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require mm > 0"), error);
            }
            try {
                await governance.setGovernanceParameter(toBytes32("maintenanceMarginRate"), toWad(0.005));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require lpr < mm"), error);
            }
            await governance.setGovernanceParameter(toBytes32("penaltyFundRate"), toWad(0.006));
            try {
                await governance.setGovernanceParameter(toBytes32("maintenanceMarginRate"), toWad(0.006));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require pfr < mm"), error);
            }
            try {
                await governance.setGovernanceParameter(toBytes32("liquidationPenaltyRate"), toWad(0.05));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require lpr < mm"), error);
            }
            try {
                await governance.setGovernanceParameter(toBytes32("penaltyFundRate"), toWad(0.05));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require pfr < mm"), error);
            }
            try {
                await governance.setGovernanceParameter(toBytes32("lotSize"), toWad(1));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require tls % ls == 0"), error);
            }

            await governance.setGovernanceParameter(toBytes32("tradingLotSize"), toWad(1));
            await governance.setGovernanceParameter(toBytes32("lotSize"), toWad(1));

            try {
                await governance.setGovernanceParameter(toBytes32("tradingLotSize"), toWad(0.5));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require tls % ls == 0"), error);
            }

            try {
                await governance.setGovernanceParameter(toBytes32("longSocialLossPerContracts"), toWad(0.5));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("wrong perpetual status"), error);
            }

            try {
                await governance.setGovernanceParameter(toBytes32("shortSocialLossPerContracts"), toWad(0.5));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("wrong perpetual status"), error);
            }
        });

        it("setGovernanceAddress exceptions", async () => {
            try {
                await governance.setGovernanceAddress(toBytes32("dev"), "0x0000000000000000000000000000000000000000");
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("invalid address"), error);
            }

            try {
                await governance.setGovernanceAddress(toBytes32("notexists"), "0x0000000000000000000000000000000000000001");
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("key not exists"), error);
            }
        });
    });

    describe("set parameters", async () => {
        beforeEach(deploy);

        it('set dev address', async () => {
            assert.equal(await governance.devAddress(), "0x0000000000000000000000000000000000000000");
            await governance.setGovernanceAddress(toBytes32("dev"), u1);
            assert.equal(await governance.devAddress(), u1);
        });

        it('set global config', async () => {
            let config = await GlobalConfig.new();
            await governance.setGovernanceAddress(toBytes32("globalConfig"), config.address);
            addr = await governance.globalConfig();
            assert.equal(addr, config.address);

            config = await GlobalConfig.at(addr);
        });

        it('set funding', async () => {
            assert.equal(await governance.amm(), "0x0000000000000000000000000000000000000000");
            await governance.setGovernanceAddress(toBytes32("amm"), u2);
            assert.equal(await governance.amm(), u2);

            try {
                await governance.setGovernanceAddress(toBytes32("amm"), u3, { from: u1 });
            } catch (error) {
                assert.ok(error.message.includes("not owner"), error);
            }
        });

        it('set governance value', async () => {
            assert.equal((await governance.getGovernance()).initialMarginRate, '100000000000000000');
            await governance.setGovernanceParameter(toBytes32("initialMarginRate"), toWad(0.5));
            assert.equal((await governance.getGovernance()).initialMarginRate, toWad(0.5));

            try {
                await governance.setGovernanceParameter(toBytes32("maintenanceMarginRate"), toWad(0.5));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require mm < im"), error);
            }

            assert.equal((await governance.getGovernance()).maintenanceMarginRate, '50000000000000000');
            await governance.setGovernanceParameter(toBytes32("maintenanceMarginRate"), toWad(0.4));
            assert.equal((await governance.getGovernance()).maintenanceMarginRate, toWad(0.4));

            try {
                await governance.setGovernanceParameter(toBytes32("liquidationPenaltyRate"), toWad(0.5));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("require lpr < mm"), error);
            }

            assert.equal((await governance.getGovernance()).liquidationPenaltyRate, '5000000000000000');
            await governance.setGovernanceParameter(toBytes32("liquidationPenaltyRate"), toWad(0.3));
            assert.equal((await governance.getGovernance()).liquidationPenaltyRate, toWad(0.3));

            assert.equal((await governance.getGovernance()).penaltyFundRate, '5000000000000000');
            await governance.setGovernanceParameter(toBytes32("penaltyFundRate"), toWad(0.1));
            assert.equal((await governance.getGovernance()).penaltyFundRate, toWad(0.1));

            assert.equal((await governance.getGovernance()).takerDevFeeRate, '750000000000000');
            await governance.setGovernanceParameter(toBytes32("takerDevFeeRate"), toWad(0.5));
            assert.equal((await governance.getGovernance()).takerDevFeeRate, toWad(0.5));

            assert.equal((await governance.getGovernance()).makerDevFeeRate, '-250000000000000');
            await governance.setGovernanceParameter(toBytes32("makerDevFeeRate"), toWad(0.5));
            assert.equal((await governance.getGovernance()).makerDevFeeRate, toWad(0.5));
        });

        it('key not exists', async () => {
            try {
                await governance.setGovernanceParameter(toBytes32("llllrate"), toWad(0.5));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("key not exists"), error);
            }
        });

        it('not owner', async () => {
            try {
                await governance.setGovernanceParameter(toBytes32("takerDevFeeRate"), toWad(0.5), { from: u2 });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("not owner"), error);
            }
        });
    });

    describe("status", async () => {
        beforeEach(deploy);

        it('set governance value', async () => {
            assert.equal((await ammGovernance.getGovernance()).poolFeeRate, '375000000000000');
            await ammGovernance.setGovernanceParameter(toBytes32("poolFeeRate"), toWad(0.5));
            assert.equal((await ammGovernance.getGovernance()).poolFeeRate, toWad(0.5));

            assert.equal((await ammGovernance.getGovernance()).poolDevFeeRate, '375000000000000');
            await ammGovernance.setGovernanceParameter(toBytes32("poolDevFeeRate"), toWad(0.4));
            assert.equal((await ammGovernance.getGovernance()).poolDevFeeRate, toWad(0.4));

            try {
                await ammGovernance.setGovernanceParameter(toBytes32("emaAlpha"), toWad(-0.5));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("alpha should be > 0"), error);
            }

            assert.equal((await ammGovernance.getGovernance()).emaAlpha, '3327787021630616');
            await ammGovernance.setGovernanceParameter(toBytes32("emaAlpha"), toWad(0.5));
            assert.equal((await ammGovernance.getGovernance()).emaAlpha, toWad(0.5));

            assert.equal((await ammGovernance.getGovernance()).updatePremiumPrize, '0');
            await ammGovernance.setGovernanceParameter(toBytes32("updatePremiumPrize"), toWad(0.3));
            assert.equal((await ammGovernance.getGovernance()).updatePremiumPrize, toWad(0.3));

            assert.equal((await ammGovernance.getGovernance()).markPremiumLimit, '5000000000000000');
            await ammGovernance.setGovernanceParameter(toBytes32("markPremiumLimit"), toWad(0.1));
            assert.equal((await ammGovernance.getGovernance()).markPremiumLimit, toWad(0.1));

            assert.equal((await ammGovernance.getGovernance()).fundingDampener, '500000000000000');
            await ammGovernance.setGovernanceParameter(toBytes32("fundingDampener"), toWad(0.2));
            assert.equal((await ammGovernance.getGovernance()).fundingDampener, toWad(0.2));

            assert.equal(await ammGovernance.priceFeeder(), "0x0000000000000000000000000000000000000000");
            const priceFeeder = await PriceFeeder.new();
            await ammGovernance.setGovernanceParameter(toBytes32("priceFeeder"), priceFeeder.address);
            assert.equal(await ammGovernance.priceFeeder(), priceFeeder.address);
            try {
                await ammGovernance.setGovernanceParameter(toBytes32("priceFeeder"), "0x0000000000000000000000000000000000000000");
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("wrong address"), error);
            }
            try {
                await ammGovernance.setGovernanceParameter(toBytes32("priceFeeder"), admin);
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("wrong address"), error);
            }

        });

        it('key not exists', async () => {
            try {
                await ammGovernance.setGovernanceParameter(toBytes32("llllrate"), toWad(0.5));
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("key not exists"), error);
            }
        });
    });

    const isEmergency = async () => {
        const status = await governance.status();
        return status == EMERGENCY
    }

    const isGlobalSettled = async () => {
        const status = await governance.status();
        return status == SETTLED
    }
    describe("exceptions", async () => {
        beforeEach(deploy);

        it ("global config - owner", async () => {
            try {
                await globalConfig.addBroker(u1, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("not the owner"));
            }
            try {
                await globalConfig.removeBroker(u1, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("not the owner"));
            }
            try {
                await globalConfig.addComponent(u1, u2, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("not the owner"));
            }
            try {
                await globalConfig.removeComponent(u1, u2, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("not the owner"));
            }
            try {
                await globalConfig.addPauseController(u1, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("not the owner"));
            }
            try {
                await globalConfig.removePauseController(u1, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("not the owner"));
            }
            try {
                await globalConfig.addWithdrawController(u1, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("not the owner"));
            }
            try {
                await globalConfig.removeWithdrawController(u1, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("not the owner"));
            }
        });

        it ("broker", async () => {
            await globalConfig.transferOwnership(u1);
            await globalConfig.addBroker(u2, {from: u1});
            try {
                await globalConfig.addBroker(u2, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("address already exist"));
            }
            assert.ok(await globalConfig.brokers(u2));
            await globalConfig.removeBroker(u2, {from: u1});
            try {
                await globalConfig.removeBroker(u2, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("address not exist"));
            }
            assert.ok(!(await globalConfig.brokers(u2)));
        });

        it ("PauseController", async () => {
            await globalConfig.transferOwnership(u1);
            await globalConfig.addPauseController(u2, {from: u1});
            try {
                await globalConfig.addPauseController(u2, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("address already exist"));
            }
            assert.ok(await globalConfig.pauseControllers(u2));
            await globalConfig.removePauseController(u2, {from: u1});
            try {
                await globalConfig.removePauseController(u2, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("address not exist"));
            }
            assert.ok(!(await globalConfig.pauseControllers(u2)));
        });

        it ("WithdrawController", async () => {
            await globalConfig.transferOwnership(u1);
            await globalConfig.addWithdrawController(u2, {from: u1});
            try {
                await globalConfig.addWithdrawController(u2, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("address already exist"));
            }
            assert.ok(await globalConfig.withdrawControllers(u2));
            await globalConfig.removeWithdrawController(u2, {from: u1});
            try {
                await globalConfig.removeWithdrawController(u2, {from: u1});
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("address not exist"));
            }
            assert.ok(!(await globalConfig.withdrawControllers(u2)));
        });


        it ("component", async () => {
            await globalConfig.addComponent(u1, u2);
            try {
                await globalConfig.addComponent(u1, u2);
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("component already exist"));
            }
            assert.ok(await globalConfig.isComponent(u2, { from: u1 }));

            await globalConfig.removeComponent(u1, u2);
            try {
                await globalConfig.removeComponent(u1, u2);
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("component not exist"));
            }
            assert.ok(!(await globalConfig.isComponent(u2, { from: u1 })));
        });
    });
});