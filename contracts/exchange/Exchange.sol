pragma solidity 0.5.15;
pragma experimental ABIEncoderV2; // to enable structure-type parameter

import "../lib/LibMath.sol";
import "../lib/LibOrder.sol";
import "../lib/LibSignature.sol";
import "../interface/IGlobalConfig.sol";
import "../interface/IPerpetual.sol";
import "../interface/IAMM.sol";

contract Exchange {
    using LibMathSigned for int256;
    using LibMathUnsigned for uint256;
    using LibOrder for LibOrder.Order;
    using LibOrder for LibOrder.OrderParam;
    using LibSignature for LibSignature.OrderSignature;

    // to verify the field in order data, increase if there are incompatible update in order's data.
    uint256 public constant SUPPORTED_ORDER_VERSION = 2;
    IGlobalConfig public globalConfig;

    // order status
    mapping(bytes32 => uint256) public filled;
    mapping(bytes32 => bool) public cancelled;
    mapping(address => mapping(address => address)) public delegators;

    event MatchWithOrders(
        address perpetual,
        LibOrder.OrderParam takerOrderParam,
        LibOrder.OrderParam makerOrderParam,
        uint256 amount
    );
    event MatchWithAMM(address perpetual, LibOrder.OrderParam takerOrderParam, uint256 amount);
    event Cancel(bytes32 indexed orderHash);
    event UpdateDelegate(address indexed trader, address indexed perpetual, address indexed newDelegator);

    constructor(address _globalConfig) public {
        globalConfig = IGlobalConfig(_globalConfig);
    }

    function setDelegator(address perpetual, address newDelegator) external {
        require(delegators[msg.sender][perpetual] != newDelegator, "delegate already set");
        delegators[msg.sender][perpetual] = newDelegator;
        emit UpdateDelegate(msg.sender, perpetual, newDelegator);
    }

    function unsetDelegator(address perpetual) external {
        require(delegators[msg.sender][perpetual] != address(0), "delegate not set");
        delete delegators[msg.sender][perpetual];
        emit UpdateDelegate(msg.sender, perpetual, address(0));
    }

    function isDelegator(address trader, address perpetual, address target) public view returns (bool) {
        address delegator = delegators[trader][perpetual];
        return delegator != address(0) && target == delegator;
    }

    /**
     * Match orders from one taker and multiple makers.
     *
     * @param takerOrderParam   Taker's order to match.
     * @param makerOrderParams  Array of maker's order to match with.
     * @param _perpetual        Address of perpetual contract.
     * @param amounts           Array of matching amounts of each taker/maker pair.
     */
    function matchOrders(
        LibOrder.OrderParam memory takerOrderParam,
        LibOrder.OrderParam[] memory makerOrderParams,
        address _perpetual,
        uint256[] memory amounts
    ) public {
        require(globalConfig.brokers(msg.sender), "unauthorized broker");
        require(amounts.length > 0 && makerOrderParams.length == amounts.length, "no makers to match");
        require(!takerOrderParam.isMakerOnly(), "taker order is maker only");

        IPerpetual perpetual = IPerpetual(_perpetual);
        require(perpetual.status() == LibTypes.Status.NORMAL, "wrong perpetual status");

        uint256 tradingLotSize = perpetual.getGovernance().tradingLotSize;
        bytes32 takerOrderHash = validateOrderParam(perpetual, takerOrderParam);
        uint256 takerFilledAmount = filled[takerOrderHash];
        uint256 takerOpened;

        for (uint256 i = 0; i < makerOrderParams.length; i++) {
            if (amounts[i] == 0) {
                continue;
            }

            require(takerOrderParam.trader != makerOrderParams[i].trader, "self trade");
            require(takerOrderParam.isInversed() == makerOrderParams[i].isInversed(), "invalid inversed pair");
            require(takerOrderParam.isSell() != makerOrderParams[i].isSell(), "side must be long or short");
            require(!makerOrderParams[i].isMarketOrder(), "market order cannot be maker");

            validatePrice(takerOrderParam, makerOrderParams[i]);

            bytes32 makerOrderHash = validateOrderParam(perpetual, makerOrderParams[i]);
            uint256 makerFilledAmount = filled[makerOrderHash];

            require(amounts[i] <= takerOrderParam.amount.sub(takerFilledAmount), "taker overfilled");
            require(amounts[i] <= makerOrderParams[i].amount.sub(makerFilledAmount), "maker overfilled");
            require(amounts[i].mod(tradingLotSize) == 0, "amount must be divisible by tradingLotSize");

            uint256 opened = fillOrder(perpetual, takerOrderParam, makerOrderParams[i], amounts[i]);

            takerOpened = takerOpened.add(opened);
            filled[makerOrderHash] = makerFilledAmount.add(amounts[i]);
            takerFilledAmount = takerFilledAmount.add(amounts[i]);
        }

        // all trades done, check taker safe.
        if (takerOpened > 0) {
            require(perpetual.isIMSafe(takerOrderParam.trader), "taker initial margin unsafe");
        } else {
            require(perpetual.isSafe(takerOrderParam.trader), "maker unsafe");
        }
        require(perpetual.isSafe(msg.sender), "broker unsafe");

        filled[takerOrderHash] = takerFilledAmount;
    }

    /**
     * @dev Match orders from taker with amm. It is exactly same with directly trading from amm.
     *
     * @param takerOrderParam  Taker's order to match.
     * @param _perpetual        Address of perpetual contract.
     * @param amount           Amount to fiil.
     * @return Opened position amount of taker.
     */
    function matchOrderWithAMM(
        LibOrder.OrderParam memory takerOrderParam,
        address _perpetual,
        uint256 amount
    ) public {
        require(globalConfig.brokers(msg.sender), "unauthorized broker");
        require(amount > 0, "amount must be greater than 0");
        require(!takerOrderParam.isMakerOnly(), "taker order is maker only");

        IPerpetual perpetual = IPerpetual(_perpetual);
        IAMM amm = IAMM(perpetual.amm());

        bytes32 takerOrderHash = validateOrderParam(perpetual, takerOrderParam);
        uint256 takerFilledAmount = filled[takerOrderHash];
        require(amount <= takerOrderParam.amount.sub(takerFilledAmount), "taker overfilled");

        // trading with pool
        uint256 takerOpened;
        uint256 price = takerOrderParam.getPrice();
        uint256 expired = takerOrderParam.expiredAt();
        if (takerOrderParam.isSell()) {
            takerOpened = amm.sellFromWhitelisted(
                takerOrderParam.trader,
                amount,
                price,
                expired
            );
        } else {
            takerOpened = amm.buyFromWhitelisted(takerOrderParam.trader, amount, price, expired);
        }
        filled[takerOrderHash] = filled[takerOrderHash].add(amount);

        emit MatchWithAMM(_perpetual, takerOrderParam, amount);
    }

    /**
     * @dev Cancel order.
     *
     * @param order Order to cancel.
     */
    function cancelOrder(LibOrder.Order memory order) public {
        require(msg.sender == order.trader || msg.sender == order.broker, "invalid caller");

        bytes32 orderHash = order.getOrderHash();
        cancelled[orderHash] = true;

        emit Cancel(orderHash);
    }

    /**
     * @dev Get current chain id. need istanbul hardfork.
     *
     * @return Current chain id.
     */
    function getChainId() public pure returns (uint256 id) {
        assembly {
            id := chainid()
        }
    }

    /**
     * @dev Fill order at the maker's price, then claim trading and dev fee from both side.
     *
     * @param perpetual        Address of perpetual contract.
     * @param takerOrderParam  Taker's order to match.
     * @param makerOrderParam  Maker's order to match.
     * @param amount           Amount to fiil.
     * @return Opened position amount of taker.
     */
    function fillOrder(
        IPerpetual perpetual,
        LibOrder.OrderParam memory takerOrderParam,
        LibOrder.OrderParam memory makerOrderParam,
        uint256 amount
    ) internal returns (uint256) {
        uint256 price = makerOrderParam.getPrice();
        (uint256 takerOpened, uint256 makerOpened) = perpetual.tradePosition(
            takerOrderParam.trader,
            makerOrderParam.trader,
            takerOrderParam.side(),
            price,
            amount
        );

        // trading fee
        int256 takerTradingFee = amount.wmul(price).toInt256().wmul(takerOrderParam.takerFeeRate());
        claimTradingFee(perpetual, takerOrderParam.trader, takerTradingFee);
        int256 makerTradingFee = amount.wmul(price).toInt256().wmul(makerOrderParam.makerFeeRate());
        claimTradingFee(perpetual, makerOrderParam.trader, makerTradingFee);

        // dev fee
        claimTakerDevFee(perpetual, takerOrderParam.trader, price, takerOpened, amount.sub(takerOpened));
        claimMakerDevFee(perpetual, makerOrderParam.trader, price, makerOpened, amount.sub(makerOpened));
        if (makerOpened > 0) {
            require(perpetual.isIMSafe(makerOrderParam.trader), "maker initial margin unsafe");
        } else {
            require(perpetual.isSafe(makerOrderParam.trader), "maker unsafe");
        }

        emit MatchWithOrders(address(perpetual), takerOrderParam, makerOrderParam, amount);

        return takerOpened;
    }

    /**
     * @dev Check prices are meet.
     *
     * @param takerOrderParam  Taker's order.
     * @param takerOrderParam  Maker's order.
     * @return Opened position amount of taker.
     */
    function validatePrice(LibOrder.OrderParam memory takerOrderParam, LibOrder.OrderParam memory makerOrderParam)
        internal
        pure
    {
        if (takerOrderParam.isMarketOrder()) {
            return;
        }
        uint256 takerPrice = takerOrderParam.getPrice();
        uint256 makerPrice = makerOrderParam.getPrice();
        require(takerOrderParam.isSell() ? takerPrice <= makerPrice : takerPrice >= makerPrice, "price not match");
    }

    /**
     * @dev Validate fields of order.
     *
     * @param perpetual  Instance of perpetual contract.
     * @param orderParam Order parameter.
     * @return Valid order hash.
     */
    function validateOrderParam(IPerpetual perpetual, LibOrder.OrderParam memory orderParam)
        internal
        view
        returns (bytes32)
    {
        require(orderParam.orderVersion() == SUPPORTED_ORDER_VERSION, "unsupported version");
        require(orderParam.expiredAt() >= block.timestamp, "order expired");
        require(orderParam.chainId() == getChainId(), "unmatched chainid");

        bytes32 orderHash = orderParam.getOrderHash(address(perpetual), msg.sender);
        require(!cancelled[orderHash], "cancelled order");
        address signer = orderParam.signature.getSigner(orderHash);
        require(
            signer == orderParam.trader || isDelegator(orderParam.trader, address(perpetual), signer),
            "invalid signature"
        );
        require(filled[orderHash] < orderParam.amount, "fullfilled order");

        return orderHash;
    }

    /**
     * @dev Claim trading fee. Fee goes to brokers margin account.
     *
     * @param perpetual Address of perpetual contract.
     * @param trader    Address of account who will pay fee out.
     * @param fee       Amount of fee, decimals = 18.
     */
    function claimTradingFee(
        IPerpetual perpetual,
        address trader,
        int256 fee
    )
        internal
    {
        if (fee > 0) {
            perpetual.transferCashBalance(trader, msg.sender, fee.toUint256());
        } else if (fee < 0) {
            perpetual.transferCashBalance(msg.sender, trader, fee.neg().toUint256());
        }
    }


    /**
     * @dev Claim dev fee. Especially, for fee from closing positon
     *
     * @param perpetual     Address of perpetual.
     * @param trader        Address of margin account.
     * @param price         Price of position.
     * @param openedAmount  Opened position amount.
     * @param closedAmount  Closed position amount.
     * @param feeRate       Maker's order.
     */
    function claimDevFee(
        IPerpetual perpetual,
        address trader,
        uint256 price,
        uint256 openedAmount,
        uint256 closedAmount,
        int256 feeRate
    )
        internal
    {
        if (feeRate == 0) {
            return;
        }
        address devAddress = perpetual.devAddress();
        int256 available = perpetual.availableMargin(trader);
        int256 openFee = price.wmul(openedAmount).toInt256().wmul(feeRate);
        require(openFee <= 0 || available >= openFee, "available margin too low for fee");

        int256 closeFee = price.wmul(closedAmount).toInt256().wmul(feeRate);
        if (closeFee > 0) {
            closeFee = available < 0? 0: closeFee.min(available);
        }
        int256 fee = openFee.add(closeFee);
        if (fee > 0) {
            perpetual.transferCashBalance(trader, devAddress, fee.toUint256());
        } else if (fee < 0) {
            perpetual.transferCashBalance(devAddress, trader, fee.neg().toUint256());
            require(perpetual.isSafe(devAddress), "dev unsafe");
        }
    }

    /**
     * @dev Claim dev fee in taker fee rate set by perpetual governacne.
     *
     * @param perpetual     Address of perpetual.
     * @param trader        Taker's order.
     * @param price         Maker's order.
     * @param openedAmount  Maker's order.
     * @param closedAmount  Maker's order.
     */
    function claimTakerDevFee(
        IPerpetual perpetual,
        address trader,
        uint256 price,
        uint256 openedAmount,
        uint256 closedAmount
    )
        internal
    {
        int256 rate = perpetual.getGovernance().takerDevFeeRate;
        claimDevFee(perpetual, trader, price, openedAmount, closedAmount, rate);
    }

    /**
     * @dev Claim dev fee in maker fee rate set by perpetual governacne.
     *
     * @param perpetual     Address of perpetual.
     * @param trader        Taker's order.
     * @param price         Maker's order.
     * @param openedAmount  Maker's order.
     * @param closedAmount  Maker's order.
     */
    function claimMakerDevFee(
        IPerpetual perpetual,
        address trader,
        uint256 price,
        uint256 openedAmount,
        uint256 closedAmount
    )
        internal
    {
        int256 rate = perpetual.getGovernance().makerDevFeeRate;
        claimDevFee(perpetual, trader, price, openedAmount, closedAmount, rate);
    }
}
