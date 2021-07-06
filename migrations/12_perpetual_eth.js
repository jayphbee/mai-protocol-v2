const GlobalConfig = artifacts.require('perpetual/GlobalConfig.sol');
const Perpetual = artifacts.require('perpetual/Perpetual.sol');

module.exports = async function (deployer, network, accounts) {
    const dev = accounts[0];
    const ctk = '0xB22794F905dfC64544F19C5566000B8063339C9b';
    const globalConfig = await GlobalConfig.deployed();

    await deployer.deploy(Perpetual, globalConfig.address, dev, ctk, 18, { gas: 300000000 });
};
