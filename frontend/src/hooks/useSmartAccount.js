import { useReadContract, useWriteContract, useAccount } from "wagmi";
import { FACTORY_ABI, COUNTER_ABI } from "../abis/index.js";
import { FACTORY_ADDRESS, COUNTER_ADDRESS } from "../config.js";

/**
 * useSmartAccount — read the counterfactual smart account address for the
 * connected EOA (salt = 0) and the current counter value for that account.
 */
export function useSmartAccount() {
  const { address: ownerAddress, isConnected } = useAccount();

  // Predict the counterfactual smart account address.
  const { data: smartAccountAddress, isLoading: isLoadingAddress } = useReadContract({
    abi: FACTORY_ABI,
    address: FACTORY_ADDRESS,
    functionName: "getAddress",
    args: [ownerAddress, 0n],
    query: { enabled: isConnected && !!ownerAddress },
  });

  // Read the counter value for the smart account address.
  const {
    data: counterValue,
    isLoading: isLoadingCounter,
    refetch: refetchCounter,
  } = useReadContract({
    abi: COUNTER_ABI,
    address: COUNTER_ADDRESS,
    functionName: "getCount",
    args: [smartAccountAddress],
    query: { enabled: !!smartAccountAddress },
  });

  // Deploy the smart account (create2 via factory).
  const { writeContractAsync: deployAccount, isPending: isDeploying } =
    useWriteContract();

  const deploy = async () => {
    const hash = await deployAccount({
      abi: FACTORY_ABI,
      address: FACTORY_ADDRESS,
      functionName: "createAccount",
      args: [ownerAddress, 0n],
    });
    return hash;
  };

  return {
    ownerAddress,
    smartAccountAddress,
    counterValue,
    isLoadingAddress,
    isLoadingCounter,
    isDeploying,
    deploy,
    refetchCounter,
  };
}
