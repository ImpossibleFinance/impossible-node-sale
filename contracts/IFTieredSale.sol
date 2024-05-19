// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./IFFundable.sol";
import "./IFWhitelistable.sol";

contract IFTieredSale is ReentrancyGuard, AccessControl, IFFundable, IFWhitelistable {
    using SafeERC20 for ERC20;

    ERC20 public paymentToken;

    string[] public tierIds;

    // Constants for the roles
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // Structs for tiers and promo codes
    struct Tier {
        uint256 price;  // in gwei
        uint256 maxTotalPurchasable;  // in ether
        uint256 maxAllocationPerWallet;  // in ether
        uint8 bonusPercentage;  // Additional bonus percentage for this tier
        bytes32 whitelistRootHash;
        bool isHalt;
        bool isIntegerSale;
    }

    struct PromoCode {
        uint8 discountPercentage;
        address promoCodeOwnerAddress;
        address masterOwnerAddress;
        uint256 promoCodeOwnerEarnings;  // in gwei
        uint256 masterOwnerEarnings;  // in gwei
        uint256 totalPurchased; // in ether
    }

    // State variables
    mapping(string => Tier) public tiers;
    mapping(string => mapping(address => uint256)) public purchasedAmountPerTier;  // tierId => address => amount in ether
    mapping(string => uint256) public codePurchaseAmount;  // promo code => total purchased amount in ether
    mapping(string => uint256) public saleTokenPurchasedByTier;  // tierId => total purchased amount in ether
    mapping(string => PromoCode) public promoCodes;

    // Events
    event TierUpdated(string tierId);
    event PurchasedInTier(address indexed buyer, string tierId, uint256 amount, string promoCode);
    event ReferralRewardWithdrawn(address referrer, uint256 amount);
    event PromoCodeAdded(string code, uint8 discountPercentage, address promoCodeOwnerAddress, address masterOwnerAddress);

    // Constructor
    constructor(
        ERC20 _paymentToken,
        ERC20 _saleToken,
        uint256 _startTime,
        uint256 _endTime,
        address _funder
    )
        IFFundable(_paymentToken, _saleToken, _startTime, _endTime, _funder)
        IFWhitelistable()
    {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(OPERATOR_ROLE, msg.sender);
        paymentToken = _paymentToken;
    }

    modifier onlyOperator() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(OPERATOR_ROLE, msg.sender),  "Not authorized");
        _;
    }

    // Operator management functions
    function addOperator(address operator) public onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(OPERATOR_ROLE, operator);
    }

    function removeOperator(address operator) public onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(OPERATOR_ROLE, operator);
    }

    // Tier management
    function setTier(
        string memory _tierId,
        uint256 _price,
        uint256 _maxTotalPurchasable,
        uint256 _maxAllocationPerWallet,
        bytes32 _whitelistRootHash,
        bool _isHalt,
        bool _isIntegerSale,
        uint8 _bonusPercentage
    ) public onlyOperator {
        tiers[_tierId] = Tier({
            price: _price,
            maxTotalPurchasable: _maxTotalPurchasable,
            maxAllocationPerWallet: _maxAllocationPerWallet,
            whitelistRootHash: _whitelistRootHash,
            isHalt: _isHalt,
            isIntegerSale: _isIntegerSale,
            bonusPercentage: _bonusPercentage
        });
        tierIds.push(_tierId);
        emit TierUpdated(_tierId);
    }


    function addPromoCode(string memory _code, uint8 _discountPercentage, address _promoCodeOwnerAddress, address _masterOwnerAddress) public onlyOperator {
        require(_discountPercentage <= 100, "Invalid discount percentage");
        promoCodes[_code] = PromoCode({
            discountPercentage: _discountPercentage,
            promoCodeOwnerAddress: _promoCodeOwnerAddress,
            masterOwnerAddress: _masterOwnerAddress,
            promoCodeOwnerEarnings: 0,
            masterOwnerEarnings: 0,
            totalPurchased: 0
        });
        emit PromoCodeAdded(_code, _discountPercentage, _promoCodeOwnerAddress, _masterOwnerAddress);
    }

    function whitelistedPurchaseInTierWithCode(
        string memory _tierId,
        uint256 _amount,
        bytes32[] calldata _merkleProof,
        string memory _promoCode,
        uint256 _allocation
    ) public {
        require(whitelistRootHash == bytes32(0) || MerkleProof.verify(_merkleProof, tiers[_tierId].whitelistRootHash, keccak256(abi.encodePacked(msg.sender, _allocation))), "Invalid proof");
        require(purchasedAmountPerTier[_tierId][msg.sender] + _amount <= _allocation, "Purchase exceeds allocation");
        uint discount = bytes(_promoCode).length > 0 ? promoCodes[_promoCode].discountPercentage : 0;
        require(discount > 0, 'Invalid promo code');
        uint discountedPrice = tiers[_tierId].price * (100 - discount) / 100;  // in gwei
        executePurchase(_tierId, _amount, discountedPrice, _promoCode);
    }

    function executePurchase (string memory _tierId, uint256 _amount, uint256 _price, string memory _promoCode) private nonReentrant  {
        Tier storage tier = tiers[_tierId];
        require(!tier.isHalt, "Purchases in this tier are currently halted");
        // require(_amount % tier.price == 0, "Can only purchase integer amounts in this tier");
        require(_amount % 1 == 0, "Can only purchase integer amounts in this tier");
        require(
            purchasedAmountPerTier[_tierId][msg.sender] + _amount <= tier.maxAllocationPerWallet,
            "Amount exceeds wallet's maximum allocation for this tier"
        );
        require(
            saleTokenPurchasedByTier[_tierId] + _amount <= tier.maxTotalPurchasable,
            "Amount exceeds tier's maximum total purchasable"
        );

        purchasedAmountPerTier[_tierId][msg.sender] += _amount;
        saleTokenPurchasedByTier[_tierId] += _amount;

        uint256 totalCost = _amount * _price;  // in gwei
        uint256 baseOwnerPercentage = totalCost * 8 / 100;
        uint256 masterOwnerPercentage = totalCost * 2 / 100;
        uint256 bonus = totalCost * tier.bonusPercentage / 100;

        promoCodes[_promoCode].promoCodeOwnerEarnings += baseOwnerPercentage + bonus;
        promoCodes[_promoCode].masterOwnerEarnings += masterOwnerPercentage;

        paymentToken.safeTransferFrom(msg.sender, address(this), totalCost);

        emit PurchasedInTier(msg.sender, _tierId, _amount, _promoCode);
    }


    function getSaleTokensSold() override internal view returns (uint256 amount) {
        uint256 tokenSold = 0;
        for (uint i = 0; i < tierIds.length; i++) {
            if (tiers[tierIds[i]].price == 0) {
                continue;
            }
            tokenSold += saleTokenPurchasedByTier[tierIds[i]];
        }
        return tokenSold;
    }


    function withdrawReferralRewards (string memory _promoCode) public nonReentrant  {
        require(bytes(_promoCode).length > 0, "Invalid promo code");
        PromoCode storage promo = promoCodes[_promoCode];
        require(msg.sender == promo.promoCodeOwnerAddress || msg.sender == promo.masterOwnerAddress, "Not promo code owner or master owner");

        uint256 reward = 0;
        if (msg.sender == promo.promoCodeOwnerAddress) {
            reward = promo.promoCodeOwnerEarnings;
            promo.promoCodeOwnerEarnings = 0;
        } else if (msg.sender == promo.masterOwnerAddress) {
            reward = promo.masterOwnerEarnings;
            promo.masterOwnerEarnings = 0;
        }

        require(reward > 0, "No rewards available");
        paymentToken.safeTransfer(msg.sender, reward);

        emit ReferralRewardWithdrawn(msg.sender, reward);
    }

    function _validatePromoCode(string memory _promoCode) internal view {
        if (bytes(_promoCode).length != 42) {
            return;
        }
        address promoCodeAddress;
        assembly {
            promoCodeAddress := mload(add(_promoCode, 20))
        }

        uint256 tokenSold = 0;
        for (uint i = 0; i < tierIds.length; i++) {
            if (tiers[tierIds[i]].price == 0) {
                continue;
            }
            tokenSold += purchasedAmountPerTier[tierIds[i]][promoCodeAddress];
        }
        require(tokenSold > 0, "Promo code owner has not purchased any token");
        // if the promo code is an address, check if it has purchased any node
        require(codePurchaseAmount[_promoCode] > 0, "Invalid promo code");
    }

    // Override the renounceOwnership function to disable it
    function renounceOwnership() public pure override{
        revert("ownership renunciation is disabled");
    }
}