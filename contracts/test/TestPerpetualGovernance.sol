pragma solidity 0.5.15;
pragma experimental ABIEncoderV2; // to enable structure-type parameter

import "../perpetual/PerpetualGovernance.sol";


contract TestPerpGovernance is PerpetualGovernance {

    constructor(address _globalConfig) 
        public
        PerpetualGovernance(_globalConfig) 
    {
    } 
}


