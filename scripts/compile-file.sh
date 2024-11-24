#!/bin/bash

CONTRACT_NAME=$1
CONTRACT_VERSION=$2
COMPILER_VERSION="0.8.17"
OPTIMIZATION_RUNS=200  # Define optimization runs variable

if [ -z "$CONTRACT_NAME" ] || [ -z "$CONTRACT_VERSION" ]; then
  echo "Usage: $0 <CONTRACT_NAME> <CONTRACT_VERSION>"
  exit 1
fi

OUTPUT_CONTRACT="${CONTRACT_NAME}${CONTRACT_VERSION}"

# Copy the source file to a new file with the desired output contract name
cp contracts/${CONTRACT_NAME}.sol contracts/${OUTPUT_CONTRACT}.sol

# Replace "contract <CONTRACT_NAME>" with "contract <OUTPUT_CONTRACT>" in the generated file
sed -i "s/contract $CONTRACT_NAME/contract $OUTPUT_CONTRACT/" contracts/${OUTPUT_CONTRACT}.sol

# Export ABI and flatten contract
npx hardhat export-abi
echo "Contract $OUTPUT_CONTRACT ABI exported successfully"

# Flatten contract
FLATTENED_CONTRACT_PATH="resources/flattened/${OUTPUT_CONTRACT}.sol"
npx hardhat flatten contracts/${OUTPUT_CONTRACT}.sol > $FLATTENED_CONTRACT_PATH

# Add SPDX License Identifier
sed -i '/SPDX-License-Identifier/d' $FLATTENED_CONTRACT_PATH
sed -i '1s/^/\/\/ SPDX-License-Identifier: MIT\n/' $FLATTENED_CONTRACT_PATH

# Add Solidity version and optimization runs to the top of the flattened contract
sed -i "2i // Solidity Compiler Version: ${COMPILER_VERSION}" $FLATTENED_CONTRACT_PATH
sed -i "3i // Optimization Runs: ${OPTIMIZATION_RUNS}" $FLATTENED_CONTRACT_PATH

echo "Contract $OUTPUT_CONTRACT flattened successfully"
echo "Flattened contract stored at: $FLATTENED_CONTRACT_PATH"

echo "Compiling contract $OUTPUT_CONTRACT with version $COMPILER_VERSION"
# Compile contract
docker run -v $PWD:/sources ethereum/solc:$COMPILER_VERSION --via-ir --ir-optimized --optimize --optimize-runs=$OPTIMIZATION_RUNS --bin /sources/contracts/${OUTPUT_CONTRACT}.sol --include-path /sources/node_modules/ --base-path /sources -o /sources/${OUTPUT_CONTRACT}.bin --overwrite

# Convert OUTPUT_CONTRACT to start with lowercase for Go file to match the backend convention
OUTPUT_CONTRACT_LOWERCASE="$(echo "${OUTPUT_CONTRACT}" | sed 's/^\(.\)/\L\1/')"
GO_FILE_PATH="./resources/go-file/${OUTPUT_CONTRACT_LOWERCASE}.go"

# Generate Go file from ABI and binary
abigen --abi=abi/contracts/${OUTPUT_CONTRACT}.sol/${OUTPUT_CONTRACT}.json --pkg=${OUTPUT_CONTRACT_LOWERCASE} --out=$GO_FILE_PATH --bin ${OUTPUT_CONTRACT}.bin/${OUTPUT_CONTRACT}.bin

echo "Go file generated successfully"
echo "Go file stored at: $GO_FILE_PATH"
