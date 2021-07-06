const ContractReader = artifacts.require('reader/ContractReader.sol');
const GlobalConfig = artifacts.require('global/GlobalConfig.sol');
const Exchange = artifacts.require('exchange/Exchange.sol');

module.exports = async function (deployer, network, accounts) {
    const contractReader = await ContractReader.deployed();
    const globalConfig = await GlobalConfig.deployed();

    await deployer.deploy(Exchange, globalConfig.address, { gas: 200000000 });
    const exchange = await Exchange.deployed();

    console.log('  「 Address summary 」--------------------------------------');
    console.log('   > contractReader: ', contractReader.address);
    console.log('   > globalConfig:   ', globalConfig.address);
    console.log('   > exchange:       ', exchange.address);
};
