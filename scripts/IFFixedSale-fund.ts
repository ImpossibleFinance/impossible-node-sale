// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat'

import IFFixedSale from '../artifacts/contracts/IFFixedSale.sol/IFFixedSale.json'
import ERC20 from '../artifacts/contracts/GenericToken.sol/GenericToken.json'

export async function main(): Promise<void> {
  // params
  const fixedSale: string = process.env.SALE || '' // address
  const amount: string = process.env.AMOUNT || '' // amount to fund

  // get fixedSale contract
  const fixedSaleContract = new hre.ethers.Contract(
    fixedSale,
    IFFixedSale.abi
  )

  // get original saleAmount
  const originalSaleAmount = (
    await fixedSaleContract
      .connect((await hre.ethers.getSigners())[0])
      .saleAmount()
  ).toString()

  // get sale token
  const saleToken = (
    await fixedSaleContract
      .connect((await hre.ethers.getSigners())[0])
      .saleToken()
  ).toString()
  const saleTokenContract = new hre.ethers.Contract(saleToken, ERC20.abi)

  // approve
  const approve = await saleTokenContract
    .connect((await hre.ethers.getSigners())[0])
    .approve(fixedSale, amount)

  // wait for approve to be mined
  await approve.wait()

  // fund
  const result = await fixedSaleContract
    .connect((await hre.ethers.getSigners())[0])
    .fund(amount)

  // wait for fund to be mined
  await result.wait()

  // get saleAmount
  const newSaleAmount = (
    await fixedSaleContract
      .connect((await hre.ethers.getSigners())[0])
      .saleAmount()
  ).toString()

  // log
  console.log('Sale:', fixedSale)
  console.log('Amount:', amount)
  console.log('---- Output ----')
  console.log('Tx hash:', result.hash)
  console.log('Original sale amount:', originalSaleAmount)
  console.log('New sale amount:', newSaleAmount)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
