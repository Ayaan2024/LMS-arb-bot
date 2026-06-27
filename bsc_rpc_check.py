from dotenv import load_dotenv
import os
from web3 import Web3


def main() -> None:
    load_dotenv()

    rpc_url = os.getenv("BSC_RPC_URL")
    if not rpc_url:
        print("Connected: False")
        print("Error: BSC_RPC_URL is not set in .env")
        return

    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 15}))
    connected = w3.is_connected()
    print("Connected:", connected)

    if not connected:
        print("Error: Could not connect to BSC RPC endpoint")
        return

    print("Block number:", w3.eth.block_number)


if __name__ == "__main__":
    main()
