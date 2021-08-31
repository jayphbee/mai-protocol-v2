const assert = require('assert');
const BigNumber = require('bignumber.js');
const { increaseEvmBlock, increaseEvmTime, createEVMSnapshot, restoreEVMSnapshot, toBytes32, assertApproximate } = require('./funcs');
const { toWei, fromWei, toWad, fromWad, infinity, Side } = require('./constants');

const TestToken = artifacts.require('test/TestToken.sol');
const PriceFeeder = artifacts.require('test/TestPriceFeeder.sol');
const GlobalConfig = artifacts.require('perpetual/GlobalConfig.sol');
const Perpetual = artifacts.require('perpetual/Perpetual.sol');
const AMM = artifacts.require('test/TestAMM.sol');
const Proxy = artifacts.require('proxy/Proxy.sol');
const ContractReader = artifacts.require('reader/ContractReader.sol');

contract('contractReader', accounts => {
    let priceFeeder;
    let collateral;
    let globalConfig;
    let perpetual;
    let proxy;
    let amm;
    let contractReader;

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
        contractReader = await ContractReader.new();
    };

    const setIndexPrice = async price => {
        await priceFeeder.setPrice(toWad(price));

        // priceFeeder will modify index.timestamp, amm.timestamp should >= index.timestamp
        const index = await amm.indexPrice();
        await amm.setBlockTimestamp(index.timestamp);
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
        await amm.setGovernanceParameter(toBytes32("updatePremiumPrize"), toWad(0));
        await amm.setGovernanceParameter(toBytes32('emaAlpha'), '3327787021630616'); // 2 / (600 + 1)
        await amm.setGovernanceParameter(toBytes32('markPremiumLimit'), toWad(0.005));
        await amm.setGovernanceParameter(toBytes32('fundingDampener'), toWad(0.0005));
    };

    beforeEach(async () => {
        snapshotId = await createEVMSnapshot();

        await deploy();
        await setIndexPrice(7000);
        await useDefaultGovParameters();
        await usePoolDefaultParameters();

        // create amm
        await collateral.transfer(u1, toWad(7000 * 100 * 2.1));
        await collateral.approve(perpetual.address, infinity, { from: u1 });
        await perpetual.deposit(toWad(7000 * 100 * 2.1), { from: u1 });
        await amm.createPool(toWad(100), { from: u1 });
    });

    afterEach(async function () {
        await restoreEVMSnapshot(snapshotId);
    });

    it('getGovParams', async () => {
        const p = await contractReader.getGovParams(perpetual.address);

        assert.equal(fromWad(p.perpGovernanceConfig.initialMarginRate), 0.1);
        assert.equal(fromWad(p.perpGovernanceConfig.maintenanceMarginRate), 0.05);
        assert.equal(fromWad(p.perpGovernanceConfig.liquidationPenaltyRate), 0.005);
        assert.equal(fromWad(p.perpGovernanceConfig.penaltyFundRate), 0.005);
        assert.equal(fromWad(p.perpGovernanceConfig.takerDevFeeRate), 0.01);
        assert.equal(fromWad(p.perpGovernanceConfig.makerDevFeeRate), 0.01);
        assert.equal(p.perpGovernanceConfig.lotSize, 1);
        assert.equal(p.perpGovernanceConfig.tradingLotSize, 1);

        assert.equal(fromWad(p.ammGovernanceConfig.poolFeeRate), 0.01);
        assert.equal(fromWad(p.ammGovernanceConfig.poolDevFeeRate), 0.005);
        assert.equal(p.ammGovernanceConfig.emaAlpha.toString(), '3327787021630616');
        assert.equal(fromWad(p.ammGovernanceConfig.markPremiumLimit), 0.005);
        assert.equal(fromWad(p.ammGovernanceConfig.fundingDampener), 0.0005);
        assert.equal(p.amm, amm.address);
        assert.equal(p.poolAccount, proxy.address);
    });

    it('getPerpetualStorage', async () => {
        const p = await contractReader.getPerpetualStorage(perpetual.address);
        assert.equal(p.collateralTokenAddress, collateral.address);
        assert.equal(fromWad(p.totalSize), 100);
        assert.equal(fromWad(p.longSocialLossPerContract), 0);
        assert.equal(fromWad(p.shortSocialLossPerContract), 0);
        assert.equal(fromWad(p.insuranceFundBalance), 0);
        assert.equal(p.isEmergency, false);
        assert.equal(p.isGlobalSettled, false);
        assert.equal(p.isPaused, false);
        assert.equal(p.isWithdrawDisabled, false);
        assert.notEqual(fromWad(p.fundingParams.lastFundingTime), 0);
        assert.equal(fromWad(p.fundingParams.lastPremium), 0);
        assert.equal(fromWad(p.fundingParams.lastEMAPremium), 0);
        assert.equal(fromWad(p.fundingParams.lastIndexPrice), 7000);
        assert.equal(fromWad(p.fundingParams.accumulatedFundingPerContract), 0);
        assert.notEqual(fromWad(p.oracleTime), 0);
        assert.equal(fromWad(p.oraclePrice), 7000);

        await setIndexPrice(7100);
        const p2 = await contractReader.getPerpetualStorage(perpetual.address);
        assert.equal(fromWad(p2.fundingParams.lastIndexPrice), 7000);
        assert.equal(fromWad(p2.oraclePrice), 7100);

        await amm.updateIndex();
        const p3 = await contractReader.getPerpetualStorage(perpetual.address);
        assert.equal(fromWad(p3.fundingParams.lastIndexPrice), 7100);
        assert.equal(fromWad(p3.oraclePrice), 7100);
    });

    it('getAccountStorage', async () => {
        const p = await contractReader.getAccountStorage(perpetual.address, u1);
        assert.equal(fromWad(p.cashBalance), 70000);
        assert.equal(parseInt(p.side), 1);
        assert.equal(fromWad(p.size), 100);
        assert.equal(fromWad(p.entryValue), 700000);
        assert.equal(fromWad(p.entrySocialLoss), 0);
        assert.equal(fromWad(p.entryFundingLoss), 0);
    });
});
