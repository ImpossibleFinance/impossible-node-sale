# IDIA Node Sale Contracts

In this repo, we will feature a new IDIA staking launchpad mechanism.

For documentation on our launchpad logic, please visit here:
https://docs.impossible.finance/launchpad/smart-contracts

## Setup

```
yarn install
```

## Test

### Running all tests

```
npx hardhat test
```

### Inspect transactions on ethernal

Make sure ethernal is installed: https://doc.tryethernal.com/getting-started/quickstart

Spin up local node

```
npx hardhat node --fork <NODE RPC URL>
```

Turn on ethernal listener

```
ethernal listen
```

Import ethernal to the test script

```typescript
import 'hardhat-ethernal'
```

Run test case with ethernal credentials. Connect it to local node.

```
ETHERNAL_EMAIL=<YOUR EMAIL> ETHERNAL_PASSWORD=<YOUR PASSWORD> npx hardhat run <FILE PATH> --network localhost
```

Login and browse the transactions at https://app.tryethernal.com

## Deploy

### Deploy commands

# allocation sale

SELLER=0xABCD PAY_TOKEN=0xABCD SALE_TOKEN=0xABCD ALLOCATION_MASTER=0xABCD TRACK_ID=123 SNAP_BLOCK=123456 START_BLOCK=123456 END_BLOCK=123456 SALE_PRICE=100000000000000000000 MAX_TOTAL_PAYMENT=10000000000000000000000 npx hardhat run ./scripts/IFAllocationSale-deploy.ts --network bsc_test

## Other utilities

### Funding an allocation sale

```
SALE=0xABCD AMOUNT=10000000000000000000000 npx hardhat run ./scripts/IFAllocationSale-fund.ts --network bsc_test
```

### Setting whitelist on allocation sale

```
# via command line, for a short list
# Note: whitelist passed in as comma separated list (end comma optional). No space allowed after comma.
SALE=0xABCD WHITELIST=0xABCD,0xBCDE,0xCDEF, npx hardhat run ./scripts/IFAllocationSale-setWhitelist.ts --network bsc_test

# via file containing JSON list of address strings, for a long list
SALE=0xABCD WHITELIST_JSON_FILE=/path/to/addresses.json npx hardhat run ./scripts/IFAllocationSale-setWhitelist.ts --network bsc_test

# using optional second whitelist for intersection
SALE=0xABCD WHITELIST_JSON_FILE=/path/to/addresses.json WHITELIST_JSON_FILE_2=/path/to/addresses2.json npx hardhat run ./scripts/IFAllocationSale-setWhitelist.ts --network bsc_test
```

### Overriding Sale Token Allocation

```
SALE=0xABCD ALLOCATION=1000000000000000000000 npx hardhat run ./scripts/IFAllocationSale-setSaleTokenAllocationOverride.ts --network bsc_test
```

### Setting a delay for claim

```
SALE=0xABCD DELAY=100 npx hardhat run ./scripts/IFAllocationSale-setWithdrawDelay.ts --network bsc_test
```

### Setting a casher

```
SALE=0xABCD CASHER=0xABCD npx hardhat run ./scripts/IFAllocationSale-setCasher.ts --network bsc_test
```

### Transfering ownership

```
SALE=0xABCD NEW_OWNER=0xABCD npx hardhat run ./scripts/IFAllocationSale-transferOwnership.ts --network bsc_test
```

### Cashing

```
SALE=0xABCD npx hardhat run ./scripts/IFAllocationSale-cash.ts --network bsc_test
```

### Setting cliff periods

```
// To set cliff starting at 2022-OCT-27, lasting for 270 days, unlock every 3 days with 1 percent
SALE=0xABCD WITHDRAW_TIME=1666843153 DURATION=270 STEP=3 PCT=1 npx hardhat run scripts/IFAllocationSale-setCliffVesting.ts                            
```

## Compile contracts into go files
The base path taken by the compile script is `./contract`. 
```bash
bash scripts/compile-file.sh <CONTRACT_NAME> <VERSION>
```
```

e.g. ```bash scripts/compile-file.sh IFFixedSale V10```


Then the flattened contract will be in "/resources/flattened/".
The compiled go file will be in "/resources/go-file/"
ABI will be in "/abi/contracts/"
