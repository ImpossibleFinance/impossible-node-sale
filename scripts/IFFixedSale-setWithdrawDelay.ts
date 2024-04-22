// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat'
import IFFixedSale from '../artifacts/contracts/IFFixedSale.sol/IFFixedSale.json'

export async function main(): Promise<void> {
  // params
  const fixedSale: string = process.env.SALE || '' // address
  const withdrawDelay = process.env.DELAY || 0 // whitelisted addresses array

  // get fixedSale contract
  const fixedSaleContract = new hre.ethers.Contract(
    fixedSale,
    IFFixedSale.abi
  )

  // set delay for claim
  const result = await fixedSaleContract
    .connect((await hre.ethers.getSigners())[0])
    .setWithdrawDelay(withdrawDelay)

  // wait for tx to be mined
  await result.wait()

  // log
  console.log('Sale:', fixedSale)
  console.log('Withdraw Delay:', withdrawDelay)
  console.log('---- Output ----')
  console.log('Tx hash:', result.hash)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
