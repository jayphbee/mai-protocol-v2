const TestToken = artifacts.require('test/TestToken.sol');

module.exports = async function (deployer, network, accounts) {
    await deployer.deploy(TestToken, "TestUSDT", "USDT", 6, {gas: 200000000});

    console.log('  「 Address summary 」--------------------------------------');
    console.log('   > CTK:     ', TestToken.address);
};
