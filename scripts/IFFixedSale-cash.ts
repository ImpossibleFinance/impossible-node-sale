// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat'

import IFAllocationSale from '../artifacts/contracts/IFAllocationSale.sol/IFAllocationSale.json'

export async function main(): Promise<void> {
  // params
  const fixedSale: string = process.env.SALE || '' // address

  // get fixedSale contract
  const fixedSaleContract = new hre.ethers.Contract(
    fixedSale,
    IFAllocationSale.abi
  )


  // cash
  const result = await fixedSaleContract
    .connect((await hre.ethers.getSigners())[0])
    .cash()

  // wait for cash to be mined
  await result.wait()

  // log
  console.log('Sale:', fixedSale)
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
