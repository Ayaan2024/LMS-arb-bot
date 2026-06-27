import itertools
from web3 import Web3


class MultiRPCManager:
    def __init__(self, providers):
        self.providers = [p for p in providers if p and "your_quicknode" not in p]
        if not self.providers:
            self.providers = ["https://bsc-dataseed1.binance.org/"]
        self._idx = 0
        self._cycle = itertools.cycle(range(len(self.providers)))
        self.current = self.providers[self._idx]

    def failover(self):
        self._idx = next(self._cycle)
        self.current = self.providers[self._idx]
        print(f"⚠️ RPC failover -> {self.current}")

    def get_web3(self):
        return Web3(Web3.HTTPProvider(self.current))
