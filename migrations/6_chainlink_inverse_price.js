const BigNumber = require('bignumber.js')
const PriceFeeder = artifacts.require('test/TestPriceFeeder.sol');
const ChainlinkAdapter = artifacts.require('oracle/ChainlinkAdapter.sol');
const { fromWad } = require('../test/constants');

module.exports = async function (deployer, network, accounts) {
    await deployer.deploy(PriceFeeder);
    const priceFeeder = await PriceFeeder.deployed();

    await deployer.deploy(ChainlinkAdapter, priceFeeder.address, 3600 * 6, true, { gas: 200000000 });
    const chainlinkAdapter = await ChainlinkAdapter.deployed();

    console.log('  「 Address summary 」--------------------------------------');
    console.log('   > priceFeeder:     ', priceFeeder.address);
    console.log('   > ChainlinkAdapter:', chainlinkAdapter.address);

    console.log('feed price (test only)...');
    const price = (new BigNumber('240')).shiftedBy(8).dp(0, BigNumber.ROUND_DOWN);
    await priceFeeder.setPrice(price);
};
