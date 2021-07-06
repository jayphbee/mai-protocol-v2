const TestToken = artifacts.require('test/TestToken.sol');
const GlobalConfig = artifacts.require('perpetual/GlobalConfig.sol');
const Perpetual = artifacts.require('perpetual/Perpetual.sol');

module.exports = async function (deployer, network, accounts) {
    const dev = accounts[0];
    const ctk = await TestToken.deployed();
    const ctkAddress = ctk.address;
    const globalConfig = await GlobalConfig.deployed();
    
    await deployer.deploy(Perpetual, globalConfig.address, dev, ctkAddress, 6, { gas: 200000000 });
};
