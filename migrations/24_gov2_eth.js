const { toWad } = require('../test/constants');

const AMM = artifacts.require('liquidity/AMM.sol');

const toBytes32 = s => {
    return web3.utils.fromAscii(s);
};

module.exports = async function (deployer, network, accounts) {
    const amm = await AMM.deployed();

    console.log('default gov...');
    await amm.setGovernanceParameter(toBytes32("emaAlpha"), "3327787021630616"); // 2 / (600 + 1)
    await amm.setGovernanceParameter(toBytes32("updatePremiumPrize"), toWad(0));
    await amm.setGovernanceParameter(toBytes32("markPremiumLimit"), toWad(0.006));
    await amm.setGovernanceParameter(toBytes32("fundingDampener"), toWad(0.002));
};
