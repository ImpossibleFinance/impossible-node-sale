// We require the Hardhat Runtime Environment explicitly here. This is optional 
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat'

export async function main(): Promise<void> {
  // deploy params

  const seller: string = process.env.SELLER || '' // address
  const payToken: string = process.env.PAY_TOKEN || '' // address
  const saleToken: string = process.env.SALE_TOKEN || '' // address
  const startBlock: number = parseInt(process.env.START_BLOCK || '') // start block of sale (inclusive)
  const endBlock: number = parseInt(process.env.END_BLOCK || '') // end block of sale (inclusive)
  const salePrice = process.env.SALE_PRICE // amount of payment token per sale token
  const maxTotalPayment = process.env.MAX_TOTAL_PAYMENT // max total payment (per user)

  // We get the contract to deploy
  const IFFixedSaleFactory = await hre.ethers.getContractFactory('IFFixedSale')

  // deploy
  const IFFixedSale = await IFFixedSaleFactory.deploy(
    salePrice,
    seller,
    payToken,
    saleToken,
    startBlock,
    endBlock,
    maxTotalPayment
  )

  await IFFixedSale.deployed()

  console.log('IFFixedSale deployed to ', IFFixedSale.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
