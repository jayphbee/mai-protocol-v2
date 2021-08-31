const ChainlinkAdapter = artifacts.require('oracle/ChainlinkAdapter.sol');
const Perpetual = artifacts.require('perpetual/Perpetual.sol');
const AMM = artifacts.require('liquidity/AMM.sol');
const Proxy = artifacts.require('proxy/Proxy.sol');
const GlobalConfig = artifacts.require('global/GlobalConfig.sol');

module.exports = async function (deployer, network, accounts) {
    const priceFeeder = await ChainlinkAdapter.deployed();
    const perpetual = await Perpetual.deployed();
    const proxy = await Proxy.deployed();
    const globalConfig = await GlobalConfig.deployed();

    await deployer.deploy(AMM, globalConfig.address, proxy.address, priceFeeder.address, { gas: 6900000 });

    const amm = await AMM.deployed();
    console.log('  「 Address summary 」--------------------------------------');
    console.log('   > perpetual:      ', perpetual.address);
    console.log('   > proxy:          ', proxy.address);
    console.log('   > amm:            ', amm.address);
    console.log('');
};
