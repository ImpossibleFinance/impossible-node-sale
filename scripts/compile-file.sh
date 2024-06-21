CONTRACT_NAME=$1
CONTRACT_VERSION=$2
COMPILER_VERSION="0.8.17"

if [ -z "$CONTRACT_NAME" ] || [ -z "$CONTRACT_VERSION" ]; then
  echo "Usage: $0 <CONTRACT_NAME> <CONTRACT_VERSION>"
  exit 1
fi

OUTPUT_CONTRACT="${CONTRACT_NAME}${CONTRACT_VERSION}"

# Copy the source file to a new file with the desired output contract name
cp contracts/${CONTRACT_NAME}.sol contracts/${OUTPUT_CONTRACT}.sol

# Replace "contract <CONTRACT_NAME>" with "contract <OUTPUT_CONTRACT>" in the generated file
# e.g. contract MyContract -> contract MyContractV1
sed -i "s/contract $CONTRACT_NAME/contract $OUTPUT_CONTRACT/" contracts/${OUTPUT_CONTRACT}.sol

# export abi and flatten contract
npx hardhat export-abi
echo "Contract $OUTPUT_CONTRACT ABI exported successfully"

npx hardhat flatten contracts/${OUTPUT_CONTRACT}.sol > resources/flattened/${OUTPUT_CONTRACT}.sol
sed -i '/SPDX-License-Identifier/d' resources/flattened/${OUTPUT_CONTRACT}.sol  # remove SPDX-License-Identifier
sed -i '1s/^/\/\/ SPDX-License-Identifier: MIT\n/' resources/flattened/${OUTPUT_CONTRACT}.sol  # add MIT license

echo "Contract $OUTPUT_CONTRACT flattened successfully"

echo "Compiling contract $OUTPUT_CONTRACT with version $COMPILER_VERSION"
# compile contract
docker run -v $PWD:/sources ethereum/solc:$COMPILER_VERSION --ir-optimized --optimize --optimize-runs=200 --bin /sources/contracts/${OUTPUT_CONTRACT}.sol --include-path /sources/node_modules/ --base-path /sources -o /sources/${OUTPUT_CONTRACT}.bin --overwrite

abigen --abi=abi/contracts/${OUTPUT_CONTRACT}.sol/${OUTPUT_CONTRACT}.json --pkg=${OUTPUT_CONTRACT} --out=./resources/go-file/${OUTPUT_CONTRACT}.go --bin ${OUTPUT_CONTRACT}.bin/${OUTPUT_CONTRACT}.bin