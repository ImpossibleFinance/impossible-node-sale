1. Privilege of Each Role

    Default Admin Role (DEFAULT_ADMIN_ROLE):
        Can add or remove operators, casher, and funder.
        Cash from the sale contract
        Can manage tier configurations such as pricing, purchase limits, and whitelist status.
        Able to add and remove promo codes.
        Inherited from the AccessControl framework provided by OpenZeppelin.

    Operator Role (OPERATOR_ROLE):
        Can manage tier configurations such as pricing, purchase limits, and whitelist status.
        Able to add and remove promo codes.
        Manages the execution of purchases and the updates of tier status.

    Funder:
        Fund the sale contract
    
    Casher:
        Cash from the sale contract

2. Supported Scenarios

    First-Come, First-Serve Sales:
        Managed by the Tier.maxTotalPurchasable variable, which limits the total quantity of tokens purchasable per tier. Once this limit is reached, no further purchases are allowed in that tier.
    Whitelist-Based Purchases:
        Uses MerkleProof to validate purchases against a predetermined whitelist.
    Public Purchases:
        Set MerkleProof to be bytes(0) to skip the merkle proof checking
    Promo Code Discounts:
        Discounts are applied using promo codes which adjust the token price dynamically during purchases.

3. Expected Flow of Using the Contract

    Deploy the Contract:
        Instantiate with initial parameters including payment and sale tokens, timing for the sale, and the initial funder/admin.
    Set Operator and Casher Roles:
        Designate one or more addresses as operators to manage the sale dynamics.
    Configure Tiers:
        Define tiers with specific pricing, purchase caps, and whitelist roots.
    Add Promo Codes and Whitelists:
        Create promotional codes for discounts and manage whitelist entries for controlled access to the sale.
    Conduct Sales:
        Buyers make purchases within allowed tiers using or without promo codes, as applicable.
    Claim Promo Code Profits:
        Operators or promo code masters claim accumulated profits from their codes.
    Cash profits:
        safeCashPaymentToken() assume all of the rewards are valid, making sure that there will always be enough payment tokens to be withdrawn by referrers. Admin can cash the remaining payment token using cashPaymentToken() after making sure everyone has withdrawn the reward

4. Calculation of Promo Code Profits with Examples

    Profit Distribution:
        When a purchase is made using a promo code, the contract calculates the earnings for the promo code owner and the master owner.
        Base profit for the promo code owner is 8% of the total cost.
        Additional 2% of the total cost goes to the master owner.
        Any bonus percentage from the tier adds to the promo code owner's earnings.

Example Calculation:

    Suppose a purchase in a tier priced at 100 gwei per token, with 10 tokens purchased using a promo code offering a 10% discount. The tier bonus percentage is 5%.
        Discounted Price: 90 gwei per token.
        Total Cost: 900 gwei.
        Base Owner Earnings: 72 gwei (8% of total cost).
        Master Owner Earnings: 18 gwei (2% of total cost).
        Bonus: 45 gwei (5% of total cost).
        Total Promo Code Owner Earnings: 117 gwei (sum of base earnings and bonus).
        Master Owner Earnings Remain: 18 gwei.