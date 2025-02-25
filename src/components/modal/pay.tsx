import { useCallback, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface RoleSelectModalProps {
    isOpen: boolean;
    onClose: () => void;
    merchantAddress: string;
    price: number;
}


const Pay: React.FC<RoleSelectModalProps> = ({ isOpen, onClose, merchantAddress, price }) => {
    const [name, setName] = useState<string>('');
    const [phone, setPhone] = useState<string>('');
    const [amount, setAmount] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(false);
    const [currency, setCurrency] = useState<string>('');
    const [country, setCountry] = useState<string>('');
    // const [customerKey, setCustomerKey] = useState<string>('')
    // const [cryptoAmount, setCryptoAmount] = useState<string>('')

    const AUTH_TOKEN = process.env.NEXT_PUBLIC_KOTANI_API_KEY!;
    const API_URL = process.env.NEXT_PUBLIC_KOTANI_API_URL!;
    const WALLET_ID = process.env.NEXT_PUBLIC_WALLET_ID!;

    console.log(AUTH_TOKEN)
    console.log(API_URL)

    const getOrCreateCustomer = useCallback(async () => {
        try {
            const response = await fetch(`${API_URL}/customer/mobile-money/phone/${phone}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${AUTH_TOKEN}`
                }
            });
            const responseData = await response.json();
            console.log("Customer response:", responseData);

            let customerKey;

            if (responseData.success === true && responseData.data.customer_key) {
                customerKey = responseData.data.customer_key;
                console.log("Existing customer key:", customerKey);
            } else {
                const createResponse = await fetch(`${API_URL}/customer/mobile-money`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${AUTH_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        phone_number: phone,
                        country_code: country,
                        account_name: name,
                        network: "MPESA"
                    })
                });

                if (createResponse.ok) {
                    const createResponseData = await createResponse.json();
                    customerKey = createResponseData.data.customer_key;
                    console.log("New customer key:", customerKey);
                } else {
                    throw new Error('Failed to create new customer');
                }
            }

            if (!customerKey) {
                throw new Error('Customer key not found in the response');
            }

            return customerKey;
        } catch (error) {
            console.error('Error while getting/creating customer:', error);
            throw error;
        }
    }, [API_URL, AUTH_TOKEN, phone, country, name]);



    const getOnrampExchangeRate = useCallback(async () => {
        try {
            const response = await fetch(`${API_URL}/rate/onramp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AUTH_TOKEN}`
                },
                body: JSON.stringify({
                    from: currency,
                    to: "USDC",
                    fiatAmount: Number(price)
                })
            })
            if (!response.ok) {
                console.log("Error getting the rates")
                return null;
            }
            const responseData = await response.json();
            const cryptoAmount = responseData.data.cryptoAmount;
            console.log("Crypto amount:", cryptoAmount)
            return cryptoAmount;
        } catch (error) {
            console.error('Error fetching rates:', error);
            return null;
        }
    }, [currency, price, API_URL, AUTH_TOKEN]);



    if (!isOpen) return null;

    const reset = () => {
        setName('')
        setPhone('')
        setAmount(0)
        setCurrency('')
        setCountry('')
        // setCustomerKey('')
    }


    const checkTransactionStatus = async (referenceId: string, retries = 5, delay = 5000) => {
        try {
            for (let i = 0; i < retries; i++) {
                const response = await fetch(`${API_URL}/onramp/fiat-to-crypto/wallet/status/${referenceId}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${AUTH_TOKEN}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to check transaction status');
                }

                const statusData = await response.json();
                const status = statusData.data.status;

                if (status === 'SUCCESSFUL') {
                    return true;
                } else if (status === 'PENDING') {
                    console.log('Transaction still pending, checking again in a few seconds...');
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error('Transaction failed or encountered an unknown status:', status);
                    return false;
                }
            }

            console.error('Max retries reached, transaction still pending');
            return false;
        } catch (error) {
            console.error('Error checking transaction status:', error);
            return false;
        }
    };

    const checkDepositStatus = async (referenceId: string, retries = 8, delay = 10000) => {
        const toastId = toast.loading("Processing Payment...")
        try {
            for (let i = 0; i < retries; i++) {
                const response = await fetch(`${API_URL}/deposit/mobile-money/status/${referenceId}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${AUTH_TOKEN}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to check deposit status');
                }

                const statusData = await response.json();
                const status = statusData.data.status;

                if (status === 'SUCCESSFUL') {
                    toast.dismiss(toastId)
                    return true;
                } else if (status === 'PENDING') {
                    toast.success('Deposit still pending, processing...');
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    toast.error('Deposit failed or encountered an unknown status:', status);
                    return false;
                }
            }

            console.error('Max retries reached, deposit still pending');
            return false;
        } catch (error) {
            console.error('Error checking deposit status:', error);
            return false;
        } finally {
            setLoading(false)
        }
    };

    const sendToMerchantWallet = async () => {

        const toastId = toast.loading('Transferring to merchant address...', { id: 'transferToMerchant' });
        try {
            const cryptoAmount = await getOnrampExchangeRate();
            if (!cryptoAmount) {
                throw new Error('Failed to get crypto amount');
            }
            console.log("Sending crypto amount:", cryptoAmount);

            const response = await fetch(`${API_URL}/onramp/fiat-to-crypto/wallet`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AUTH_TOKEN}`
                },
                body: JSON.stringify({
                    source_wallet: WALLET_ID,
                    receivers_address: merchantAddress,
                    amount: cryptoAmount,
                    chain: "ARBITRUM",
                    token: "USDC"
                })
            });
            console.log('Deposit request:', {
                source_wallet: WALLET_ID,
                receivers_address: merchantAddress,
                amount: cryptoAmount,
            });

            if (!response.ok) {
                const responseBody = await response.json();
                console.error('Server error:', responseBody);
                toast.error(responseBody.message || 'Failed to transfer to merchant', { id: 'transferToMerchant' });
                return false;
            }

            const responseData = await response.json();
            const referenceId = responseData.data.reference_id;

            const isSuccessful = await checkTransactionStatus(referenceId);

            if (isSuccessful) {
                toast.dismiss(toastId)
                toast.success("Payment transferred to merchant successfully", { id: 'transferToMerchant' });
                return true;
            } else {
                toast.error("Transaction failed or is still pending. Please check again later.", { id: 'transferToMerchant' });
                return false;
            }
        } catch (error) {
            console.error('Error while transferring to merchant', error);
            toast.error("Failed to transfer payment to merchant. Please contact support.", { id: 'transferToMerchant' });
            return false;
        } finally {
            toast.dismiss(toastId)
            setLoading(false)
        }
    }


    const makeDeposit = async (customerKey: string) => {
        try {
            console.log(amount)
            console.log("Making deposit with customer key:", customerKey);
            const response = await fetch(`${API_URL}/deposit/mobile-money`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AUTH_TOKEN}`
                },
                body: JSON.stringify({
                    customer_key: customerKey,
                    amount: Number(price),
                    wallet_id: WALLET_ID
                }),
            });

            console.log('Deposit request:', {
                customer_key: customerKey,
                amount: Number(price),
                wallet_id: "67a335bc43babe060214fb44"
            });

            if (!response.ok) {
                const responseBody = await response.json();
                console.log(responseBody)
                throw new Error(responseBody.message || 'Failed to make deposit');
            }

            const responseData = await response.json();
            return responseData.data.reference_id;
        } catch (error) {
            console.error('Error while making deposit', error);
            throw error;
        }
    }

    const onSubmit = async () => {
        setLoading(true);

        try {
            console.log(price)
            console.log("Submitting payment for price:", price);
            const customerKey = await getOrCreateCustomer();
            console.log("Obtained customer key:", customerKey);

            const referenceId = await makeDeposit(customerKey);
            console.log("Obtained reference ID:", referenceId);

            const isDepositSuccessful = await checkDepositStatus(referenceId);

            if (isDepositSuccessful) {
                toast.success("Deposit successful.", { id: 'payment' });
                const isMerchantTransferSuccessful = await sendToMerchantWallet();

                if (isMerchantTransferSuccessful) {
                    toast.success("Payment made successfully")
                    reset();
                    onClose();
                } else {
                    toast.error("Failed to transfer to merchant. Please contact support.", { id: 'payment' });
                }
            } else {
                toast.error("Deposit failed or is still pending. Please try again later.", { id: 'payment' });
            }
        } catch (error) {
            console.error('Error while processing payment', error);
            toast.error("Failed to process payment. Please try again.", { id: 'payment' });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0  bg-opacity-100 flex items-center justify-center z-50">
            <div className='bg-gray-500 border rounded-xl flex items-center justify-center p-10 shadow-2xl w-full lg:w-1/3'>
                <div className="w-full space-y-6">
                    <h1 className='flex items-center justify-center text-[#FFFFFF] font-semibold text-xl'>Make Payment</h1>
                    <div className="space-y-1">
                        <Label>Account Name</Label>
                        <Input
                            type="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder='John Doe'
                            required
                        />
                    </div>

                    <div className='space-y-1'>
                        <Label>Country</Label>
                        <Select value={country} onValueChange={(val) => setCountry(val)}>
                            <SelectTrigger >
                                <SelectValue placeholder="Country" />
                            </SelectTrigger>
                            <SelectContent className='bg-gray-100 text-[#000]'>
                                <SelectItem value='KE'>Kenya</SelectItem>
                                <SelectItem value='GHA'>Ghana</SelectItem>
                                <SelectItem value='TZ'>Tanzania</SelectItem>
                                <SelectItem value='UG'>Uganda</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label>Phone Number</Label>
                        <Input
                            type="text"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder='+254768685444'
                            required
                        />
                    </div>
                    <div className="space-y-1">
                        <Label>Amount</Label>
                        <Input
                            type="text"
                            value={price.toString()}
                            onChange={(e) => setAmount(Number(e.target.value))}
                            readOnly
                            className="bg-gray-100 text-[#000]"
                        />
                    </div>
                    <div className='space-y-1'>
                        <Label>Currency</Label>
                        <Select value={currency} onValueChange={(val) => setCurrency(val)}>
                            <SelectTrigger >
                                <SelectValue placeholder="Currency" />
                            </SelectTrigger>
                            <SelectContent className='bg-gray-100 text-[#000]'>
                                <SelectItem value='KES'>KES</SelectItem>
                                <SelectItem value='GHS'>GHS</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className='flex flex-row gap-4 items-center justify-center'>
                        <button className='w-full bg-[#363FF9] hover:bg-[#363FF9] text-[#000] font-bold p-2 rounded ' onClick={onSubmit} disabled={loading}>
                            {loading && <Loader2 className="w-6 h-6 mr-2 animate-spin" />}
                            {loading ? 'Processing...' : 'Pay'}
                        </button>

                        <button
                            className="bg-red-500 hover:bg-red-700 text-[#000] w-full font-bold p-2 rounded"
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Pay;