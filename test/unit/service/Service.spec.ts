import { randomBytes } from 'crypto';
import { Networks } from 'boltz-core';
import { BigNumber, providers } from 'ethers';
import Logger from '../../../lib/Logger';
import Swap from '../../../lib/db/models/Swap';
import Wallet from '../../../lib/wallet/Wallet';
import ApiErrors from '../../../lib/api/Errors';
import packageJson from '../../../package.json';
import Errors from '../../../lib/service/Errors';
import { ConfigType } from '../../../lib/Config';
import { ECPair } from '../../../lib/ECPairHelper';
import Service from '../../../lib/service/Service';
import SwapManager from '../../../lib/swap/SwapManager';
import LndClient from '../../../lib/lightning/LndClient';
import ChainClient from '../../../lib/chain/ChainClient';
import FeeProvider from '../../../lib/rates/FeeProvider';
import { CurrencyInfo } from '../../../lib/proto/boltzrpc_pb';
import RateCalculator from '../../../lib/rates/RateCalculator';
import SwapRepository from '../../../lib/db/repositories/SwapRepository';
import WalletManager, { Currency } from '../../../lib/wallet/WalletManager';
import { decodeInvoice, getHexBuffer, getHexString } from '../../../lib/Utils';
import ReferralRepository from '../../../lib/db/repositories/ReferralRepository';
import ReverseSwapRepository from '../../../lib/db/repositories/ReverseSwapRepository';
import ChannelCreationRepository from '../../../lib/db/repositories/ChannelCreationRepository';
import { etherDecimals, ethereumPrepayMinerFeeGasLimit, gweiDecimals, ETHER_SYMBOL } from '../../../lib/consts/Consts';
import {
  BaseFeeType,
  CurrencyType,
  OrderSide,
  ServiceInfo,
  ServiceWarning,
  SwapUpdateEvent
} from '../../../lib/consts/Enums';

const mockGetPairs = jest.fn().mockResolvedValue([]);
const mockAddPair = jest.fn().mockReturnValue(Promise.resolve());

jest.mock('../../../lib/db/repositories/PairRepository', () => {
  return jest.fn().mockImplementation(() => ({
    addPair: mockAddPair,
    getPairs: mockGetPairs,
  }));
});

let mockGetSwapResult: any = undefined;
const mockGetSwap = jest.fn().mockImplementation(async () => {
  return mockGetSwapResult;
});

const mockAddSwap = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../lib/db/repositories/SwapRepository', () => {
  return jest.fn().mockImplementation(() => ({
    getSwap: mockGetSwap,
    addSwap: mockAddSwap,
  }));
});

const mockedSwapRepository = <jest.Mock<SwapRepository>><any>SwapRepository;

const mockAddReverseSwap = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../lib/db/repositories/ReverseSwapRepository', () => {
  return jest.fn().mockImplementation(() => ({
    addReverseSwap: mockAddReverseSwap,
  }));
});

const mockedReverseSwapRepository = <jest.Mock<ReverseSwapRepository>><any>ReverseSwapRepository;

let mockGetChannelCreationResult: any = undefined;
const mockGetChannelCreation = jest.fn().mockImplementation(() => {
  return mockGetChannelCreationResult;
});

jest.mock('../../../lib/db/repositories/ChannelCreationRepository', () => {
  return jest.fn().mockImplementation(() => ({
    getChannelCreation: mockGetChannelCreation,
  }));
});

const mockedChannelCreationRepository = <jest.Mock<ChannelCreationRepository>><any>ChannelCreationRepository;

const mockAddReferral = jest.fn().mockImplementation(async () => {});

let referralByRoutingNode: any = undefined;
const mockGetReferralByRoutingNode = jest.fn().mockImplementation(async () => {
  return referralByRoutingNode;
});

ReferralRepository.addReferral = mockAddReferral;
ReferralRepository.getReferralByRoutingNode = mockGetReferralByRoutingNode;

const mockedSwap = {
  id: 'swapId',
  keyIndex: 42,
  address: 'bcrt1',
  redeemScript: '0x',
  timeoutBlockHeight: 123,
};
const mockCreateSwap = jest.fn().mockResolvedValue(mockedSwap);

const mockSetSwapInvoice = jest.fn().mockImplementation(async (
  swap: Swap,
  _invoice: string,
  _expectedAmount: number,
  _percentageFee: number,
  _acceptZeroConf: boolean,
  emitSwapInvoiceSet: (id: string) => void,
) => {
  emitSwapInvoiceSet(swap.id);
});

const mockedReverseSwap = {
  keyIndex: 43,
  id: 'reverseId',
  invoice: 'lnbcrt1',
  redeemScript: '0x',
  lockupAddress: 'bcrt1',
  timeoutBlockHeight: 123,
  minerFeeInvoice: 'lnbcrt2',
};
const mockCreateReverseSwap = jest.fn().mockResolvedValue(mockedReverseSwap);

const mockGetRoutingHintsResultToObjectResult = { some: 'routingData' };
const mockGetRoutingHintsResultToObject = jest.fn().mockReturnValue(mockGetRoutingHintsResultToObjectResult);

const mockGetRoutingHintsResult = [
  {
    toObject: mockGetRoutingHintsResultToObject,
  },
  {
    toObject: mockGetRoutingHintsResultToObject,
  },
];
const mockGetRoutingHints = jest.fn().mockImplementation(() => mockGetRoutingHintsResult);

jest.mock('../../../lib/swap/SwapManager', () => {
  return jest.fn().mockImplementation(() => ({
    nursery: {
      on: () => {},
      channelNursery: {
        on: () => {},
      },
    },
    routingHints: {
      getRoutingHints: mockGetRoutingHints,
    },
    swapRepository: mockedSwapRepository(),
    reverseSwapRepository: mockedReverseSwapRepository(),
    channelCreationRepository: mockedChannelCreationRepository(),
    createSwap: mockCreateSwap,
    setSwapInvoice: mockSetSwapInvoice,
    createReverseSwap: mockCreateReverseSwap,
  }));
});

const mockedSwapManager = <jest.Mock<SwapManager>><any>SwapManager;

const mockGetBalance = jest.fn().mockResolvedValue({
  totalBalance: 1,
  confirmedBalance: 2,
  unconfirmedBalance: 3,
});

const newAddress = 'bcrt1';
const mockGetAddress = jest.fn().mockResolvedValue(newAddress);

const mockGetKeysByIndexResult = ECPair.fromPrivateKey(getHexBuffer('e682c45fff6f6f1d793e8d520d4660ac0f853636d47519614cc5d7e4077b1b82'));
const mockGetKeysByIndex = jest.fn().mockReturnValue(mockGetKeysByIndexResult);

const mockTransaction = {
  vout: 1,
  transactionId: 'id',
  transaction: {
    getId: () => 'id',
    toHex: () => 'hex',
  },
};
const mockSendToAddress = jest.fn().mockResolvedValue(mockTransaction);
const mockSweepWallet = jest.fn().mockResolvedValue(mockTransaction);

const ethereumAddress = '0xc3b03f52ed641e59a40e1425481a8f3655b7edd5';

const mockGetEthereumAddress = jest.fn().mockResolvedValue(ethereumAddress);

const etherBalance = 239874;
const tokenBalance = 120210;

const etherTransaction = {
  transactionId: '0x90a060627f9a489cf816e2dae8babdf94a0f866982c6f489fb57c4ed218329f8',
};

const mockSendEther = jest.fn().mockResolvedValue(etherTransaction);
const mockSweepEther = jest.fn().mockResolvedValue(etherTransaction);

const tokenTransaction = {
  transactionId: '0x1d5c0fdc8d1816b730d37373510e7054f6e09fbbbfae1e6ad1067b3f13406cfe',
};

const mockSendToken = jest.fn().mockResolvedValue(tokenTransaction);
const mockSweepToken = jest.fn().mockResolvedValue(tokenTransaction);

jest.mock('../../../lib/wallet/WalletManager', () => {
  return jest.fn().mockImplementation(() => ({
    wallets: new Map<string, Wallet>([
      ['BTC', {
        getBalance: mockGetBalance,
        getAddress: mockGetAddress,
        getKeysByIndex: mockGetKeysByIndex,
        sendToAddress: mockSendToAddress,
        sweepWallet: mockSweepWallet,
      } as any as Wallet],
      ['LTC', {
        getBalance: () => ({
          totalBalance: 0,
          confirmedBalance: 0,
          unconfirmedBalance: 0,
        }),
      } as any as Wallet],
      [ETHER_SYMBOL, {
        getAddress: mockGetEthereumAddress,
        sweepWallet: mockSweepEther,
        sendToAddress: mockSendEther,
        getBalance: jest.fn().mockResolvedValue({
          totalBalance: etherBalance,
          confirmedBalance: etherBalance,
        }),
      } as any as Wallet],
      ['TRC', {
        getAddress: mockGetEthereumAddress,
        sweepWallet: mockSweepToken,
        sendToAddress: mockSendToken,
        getBalance: jest.fn().mockResolvedValue({
          totalBalance: tokenBalance,
          confirmedBalance: tokenBalance,
        }),
      } as any as Wallet],
    ]),
  }));
});

const mockedWalletManager = <jest.Mock<WalletManager>><any>WalletManager;

const mockInitFeeProvider = jest.fn().mockReturnValue(undefined);

const mockGetFees = jest.fn().mockReturnValue({
  baseFee: 1,
  percentageFee: 1,
});

const mockGetBaseFeeResult = 320;
const mockGetBaseFee = jest.fn().mockReturnValue(mockGetBaseFeeResult);

const mockGetPercentageFeeResult = 0.02;
const mockGetPercentageFee = jest.fn().mockReturnValue(mockGetPercentageFeeResult);

jest.mock('../../../lib/rates/FeeProvider', () => {
  return jest.fn().mockImplementation(() => ({
    init: mockInitFeeProvider,
    getFees: mockGetFees,
    getBaseFee: mockGetBaseFee,
    getPercentageFee: mockGetPercentageFee,
  }));
});

const MockedFeeProvider = <jest.Mock<FeeProvider>><any>FeeProvider;

const mockCalculateRate = jest.fn().mockReturnValue(0.041);

jest.mock('../../../lib/rates/RateCalculator', () => {
  return jest.fn().mockImplementation(() => ({
    calculateRate: mockCalculateRate,
  }));
});

const MockedRateCalculator = <jest.Mock<RateCalculator>><any>RateCalculator;

const pairs = new Map<string, any>([
  ['BTC/BTC', {
    rate: 1,
    limits: {
      minimal: 1,
      maximal: Number.MAX_SAFE_INTEGER,
    },
    hash: 'hashOfBtcBtcPair',
  }],
  ['LTC/BTC', {
    rate: 0.004,
    limits: {
      minimal: 1,
      maximal: Number.MAX_SAFE_INTEGER,
    },
    hash: 'hashOfLtcBtcPair',
  }],
  ['rBTC/BTC', {
    rate: 0.041,
    limits: {
      minimal: 1,
      maximal: Number.MAX_SAFE_INTEGER,
    },
  }],
  ['test', {
    limits: {
      minimal: 5,
      maximal: 10,
    },
    hash: 'hashOfTestPair',
  }],
]);

const mockInitRateProvider = jest.fn().mockReturnValue(Promise.resolve());

const mockAcceptZeroConf = jest.fn().mockReturnValue(true);

jest.mock('../../../lib/rates/RateProvider', () => {
  return jest.fn().mockImplementation(() => ({
    pairs,
    init: mockInitRateProvider,
    feeProvider: MockedFeeProvider(),
    acceptZeroConf: mockAcceptZeroConf,
    rateCalculator: MockedRateCalculator(),
  }));
});

const mockEstimateFee = jest.fn().mockResolvedValue(2);

const mockGetNetworkInfo = jest.fn().mockResolvedValue({
  version: 180000,
  connections: 8,
});

const blockchainInfo = {
  blocks: 123,
  scannedBlocks: 321,
};
const mockGetBlockchainInfo = jest.fn().mockResolvedValue(blockchainInfo);

const rawTransaction = 'rawTransaction';
const mockGetRawTransaction = jest.fn().mockResolvedValue(rawTransaction);

let sendRawTransaction: any = 'id';
const mockSendRawTransaction = jest.fn().mockImplementation(async () => {
  if (typeof sendRawTransaction === 'string') {
    return sendRawTransaction;
  } else {
    throw sendRawTransaction;
  }
});

jest.mock('../../../lib/chain/ChainClient', () => {
  return jest.fn().mockImplementation(() => ({
    on: () => {},
    estimateFee: mockEstimateFee,
    getNetworkInfo: mockGetNetworkInfo,
    getBlockchainInfo: mockGetBlockchainInfo,
    getRawTransaction: mockGetRawTransaction,
    sendRawTransaction: mockSendRawTransaction,
  }));
});

const mockedChainClient = <jest.Mock<ChainClient>><any>ChainClient;

const lndInfo = {
  blockHeight: 123,
  version: '0.7.1-beta commit=v0.7.1-beta',

  numActiveChannels: 3,
  numInactiveChannels: 2,
  numPendingChannels: 1,

  identityPubkey: '321',
  urisList: ['321@127.0.0.1:9735', '321@hidden.onion:9735'],
};
const mockGetInfo = jest.fn().mockResolvedValue(lndInfo);

const mockSendPayment = jest.fn().mockResolvedValue({
  paymentHash: '',
  paymentRoute: {},
  paymentPreimage: Buffer.alloc(0),
});

const channelBalance = {
  localBalance: 2,
  remoteBalance: 4,
};

const mockListChannels = jest.fn().mockResolvedValue({
  channelsList: [
    {
      localBalance: channelBalance.localBalance / 2,
      remoteBalance: channelBalance.remoteBalance / 2,
    },
    {
      localBalance: channelBalance.localBalance / 2,
      remoteBalance: channelBalance.remoteBalance / 2,
    },
  ],
});

jest.mock('../../../lib/lightning/LndClient', () => {
  return jest.fn().mockImplementation(() => ({
    on: () => {},
    getInfo: mockGetInfo,
    sendPayment: mockSendPayment,
    listChannels: mockListChannels,
  }));
});

const mockedLndClient = <jest.Mock<LndClient>><any>LndClient;

const mockGetGasPriceResult = 10;
const mockGetGasPrice = jest.fn().mockResolvedValue(BigNumber.from(mockGetGasPriceResult).mul(gweiDecimals));

const mockedProvider = <jest.Mock<providers.Provider>><any>jest.fn().mockImplementation(() => ({
  getGasPrice: mockGetGasPrice,
}));

describe('Service', () => {
  const configPairs = [
    {
      base: 'BTC',
      quote: 'BTC',
      fee: 1,
      timeoutDelta: 10,
    },
    {
      base: 'LTC',
      quote: 'BTC',
      fee: 5,
      timeoutDelta: 400,
    },
    {
      base: ETHER_SYMBOL,
      quote: 'BTC',
      fee: 2,
      timeoutDelta: 180,
    },
  ];

  const currencies = new Map<string, Currency>([
    ['BTC', {
      symbol: 'BTC',
      type: CurrencyType.BitcoinLike,
      network: Networks.bitcoinRegtest,
      limits: {} as any,
      lndClient: mockedLndClient(),
      chainClient: mockedChainClient(),
    }],
    ['LTC', {
      symbol: 'LTC',
      type: CurrencyType.BitcoinLike,
      network: Networks.litecoinRegtest,
      limits: {} as any,
      lndClient: mockedLndClient(),
      chainClient: mockedChainClient(),
    }],
    [ETHER_SYMBOL, {
      symbol: ETHER_SYMBOL,
      type: CurrencyType.Ether,
      limits: {} as any,
      provider: mockedProvider(),
    }],
    ['USDT', {
      symbol: 'USDT',
      type: CurrencyType.ERC20,
      limits: {} as any,
      provider: mockedProvider(),
    }],
  ]);

  const service = new Service(
    Logger.disabledLogger,
    {
      rates: {
        interval: Number.MAX_SAFE_INTEGER,
      },
      currencies: [],
    } as any as ConfigType,
    mockedWalletManager(),
    currencies,
  );

  // Inject a mocked SwapManager
  service.swapManager = mockedSwapManager();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should not init if a currency of a pair cannot be found', async () => {
    await expect(service.init([
      {
        base: 'not',
        quote: 'BTC',
        fee: 0,
        timeoutDelta: 0,
      },
    ])).rejects.toEqual(Errors.CURRENCY_NOT_FOUND('not'));
  });

  test('should init', async () => {
    await service.init(configPairs);

    expect(mockGetPairs).toHaveBeenCalledTimes(1);

    expect(mockAddPair).toHaveBeenCalledTimes(3);
    expect(mockAddPair).toHaveBeenCalledWith({
      id: 'BTC/BTC',
      ...configPairs[0],
    });
    expect(mockAddPair).toHaveBeenCalledWith({
      id: 'LTC/BTC',
      ...configPairs[1],
    });
    expect(mockAddPair).toHaveBeenCalledWith({
      id: 'rBTC/BTC',
      ...configPairs[2],
    });

    expect(mockInitFeeProvider).toHaveBeenCalledTimes(1);
    expect(mockInitFeeProvider).toHaveBeenCalledWith(configPairs);

    expect(mockInitRateProvider).toHaveBeenCalledTimes(1);
    expect(mockInitRateProvider).toHaveBeenCalledWith(configPairs);
  });

  test('should get info', async () => {
    const info = (await service.getInfo()).toObject();

    expect(mockGetInfo).toHaveBeenCalledTimes(2);
    expect(mockGetNetworkInfo).toHaveBeenCalledTimes(2);
    expect(mockGetBlockchainInfo).toHaveBeenCalledTimes(2);

    expect(info.version.startsWith(packageJson.version)).toBeTruthy();

    const currency = info.chainsMap[0] as CurrencyInfo.AsObject;

    expect(currency[0]).toEqual('BTC');

    expect(currency[1].chain).toEqual({
      ...(await mockGetNetworkInfo()),
      ...(await mockGetBlockchainInfo()),
      error: '',
    });

    const lndInfo = await mockGetInfo();

    expect(currency[1].lnd).toEqual({
      error: '',
      version: lndInfo.version,
      blockHeight: lndInfo.blockHeight,

      lndChannels: {
        active: lndInfo.numActiveChannels,
        inactive: lndInfo.numInactiveChannels,
        pending: lndInfo.numPendingChannels,
      },
    });
  });

  test('should get balance', async () => {
    const response = await service.getBalance();
    const balances = response.getBalancesMap();

    expect(balances.get('LTC')).toBeDefined();
    expect(balances.get('BTC').toObject()).toEqual({
      walletBalance: await mockGetBalance(),
      lightningBalance: channelBalance,
    });

    expect(balances.get(ETHER_SYMBOL).toObject()).toEqual({
      walletBalance: {
        unconfirmedBalance: 0,
        totalBalance: etherBalance,
        confirmedBalance: etherBalance,
      },
    });
    expect(balances.get('TRC').toObject()).toEqual({
      walletBalance: {
        unconfirmedBalance: 0,
        totalBalance: tokenBalance,
        confirmedBalance: tokenBalance,
      },
    });
  });

  test('should get pairs', () => {
    expect(service.getPairs()).toEqual({
      pairs,
      info: [],
      warnings: [],
    });

    service.allowReverseSwaps = false;

    expect(service.getPairs()).toEqual({
      pairs,
      info: [],
      warnings: [
        ServiceWarning.ReverseSwapsDisabled,
      ],
    });

    service.allowReverseSwaps = true;

    service['prepayMinerFee'] = true;

    expect(service.getPairs()).toEqual({
      pairs,
      info: [
        ServiceInfo.PrepayMinerFee,
      ],
      warnings: [],
    });

    service['prepayMinerFee'] = false;
  });

  test('should get nodes', () => {
    expect(service.getNodes()).toEqual(new Map<string, { nodeKey: string, uris: string[] }>([
      ['BTC', {
        nodeKey: lndInfo.identityPubkey,
        uris: lndInfo.urisList,
      }],
      ['LTC', {
        nodeKey: lndInfo.identityPubkey,
        uris: lndInfo.urisList,
      }],
    ]));
  });

  test('should get routing hints', () => {
    const symbol = 'BTC';
    const routingNode = '2someNode';

    const routingHints = service.getRoutingHints(symbol, routingNode);

    expect(routingHints.length).toEqual(mockGetRoutingHintsResult.length);
    expect(routingHints).toEqual([mockGetRoutingHintsResultToObjectResult, mockGetRoutingHintsResultToObjectResult]);

    expect(mockGetRoutingHints).toHaveBeenCalledTimes(1);
    expect(mockGetRoutingHints).toHaveBeenCalledWith(symbol, routingNode);
  });

  test('should get timeouts', () => {
    expect(service.getTimeouts()).toEqual(service['timeoutDeltaProvider'].timeoutDeltas);
  });

  test('should get contracts', () => {
    const ethereumManager = {
      network: {
        some: 'networkData',
      },
      etherSwap: {
        address: '0x18A4374d714762FA7DE346E997f7e28Fb3744EC1'
      },
      erc20Swap: {
        address: '0xC685b2c4369D7bf9242DA54E9c391948079d83Cd',
      },
      tokenAddresses: new Map<string, string>([
        ['USDT', '0xDf567Cd5d0cf3d90cE6E3E9F897e092f9ECE359a']
      ]),
    };

    service['walletManager']['ethereumManager'] = ethereumManager as any;

    expect(service.getContracts()).toEqual({
      ethereum: {
        network: ethereumManager.network,
        tokens: ethereumManager.tokenAddresses,
        swapContracts: new Map<string, string>([
          ['EtherSwap', ethereumManager.etherSwap.address],
          ['ERC20Swap', ethereumManager.erc20Swap.address],
        ]),
      },
    });

    // Should throw when the Ethereum integration is not enabled
    service['walletManager']['ethereumManager'] = undefined;

    expect(() => service.getContracts()).toThrow(Errors.ETHEREUM_NOT_ENABLED().message);
  });

  test('should get transactions', async () => {
    await expect(service.getTransaction('BTC', ''))
      .resolves.toEqual(rawTransaction);

    // Throw if currency cannot be found
    const notFound = 'notFound';

    await expect(service.getTransaction(notFound, ''))
      .rejects.toEqual(Errors.CURRENCY_NOT_FOUND(notFound));
  });

  test('should get lockup transactions of swaps', async () => {
    const blockDelta = 10;

    mockGetSwapResult = {
      id: '123asd',
      pair: 'LTC/BTC',
      orderSide: OrderSide.BUY,
      timeoutBlockHeight: blockchainInfo.blocks + blockDelta,
      lockupTransactionId: 'eb63a8b1511f83c8d649fdaca26c4bc0dee4313689f62fd0f4ff8f71b963900d',
    };

    let response = await service.getSwapTransaction(mockGetSwapResult.id);

    expect(response).toEqual({
      transactionHex: rawTransaction,
      timeoutBlockHeight: mockGetSwapResult.timeoutBlockHeight,
      timeoutEta: Math.round(new Date().getTime() / 1000) + blockDelta * 10 * 60,
    });

    expect(mockGetSwap).toHaveBeenCalledTimes(1);
    expect(mockGetSwap).toHaveBeenCalledWith({
      id: mockGetSwapResult.id,
    });

    expect(mockGetBlockchainInfo).toHaveBeenCalledTimes(1);

    expect(mockGetRawTransaction).toHaveBeenCalledTimes(1);
    expect(mockGetRawTransaction).toHaveBeenCalledWith(mockGetSwapResult.lockupTransactionId);

    // Should not return an ETA if the Submarine Swap has timed out already
    mockGetSwapResult.timeoutBlockHeight = blockchainInfo.blocks;

    response = await service.getSwapTransaction(mockGetSwapResult.id);

    expect(response).toEqual({
      transactionHex: rawTransaction,
      timeoutBlockHeight: mockGetSwapResult.timeoutBlockHeight,
    });

    expect(mockGetBlockchainInfo).toHaveBeenCalledTimes(2);
    expect(mockGetRawTransaction).toHaveBeenCalledTimes(2);

    // Throw if Swap has no lockup transaction
    mockGetSwapResult.lockupTransactionId = undefined;

    await expect(service.getSwapTransaction(mockGetSwapResult.id))
      .rejects.toEqual(Errors.SWAP_NO_LOCKUP());

    // Throw if Swap cannot be found
    const id = mockGetSwapResult.id;
    mockGetSwapResult = undefined;

    await expect(service.getSwapTransaction(id))
      .rejects.toEqual(Errors.SWAP_NOT_FOUND(id));
  });

  test('should derive keys', async () => {
    const response = service.deriveKeys('BTC', 123);

    expect(response.getPublicKey()).toEqual(getHexString(mockGetKeysByIndexResult.publicKey));
    expect(response.getPrivateKey()).toEqual(getHexString(mockGetKeysByIndexResult.privateKey!));

    const notFoundSymbol = 'notFound';
    expect(() => service.deriveKeys(notFoundSymbol, 321))
      .toThrow(Errors.CURRENCY_NOT_FOUND(notFoundSymbol).message);
  });

  test('should get new addresses', async () => {
    expect(await service.getAddress('BTC')).toEqual(newAddress);

    expect(mockGetAddress).toHaveBeenCalledTimes(1);

    expect(await service.getAddress(ETHER_SYMBOL)).toEqual(ethereumAddress);
    expect(await service.getAddress('TRC')).toEqual(ethereumAddress);

    // Throw if currency cannot be found
    const notFound = 'notFound';

    await expect(service.getAddress(notFound))
      .rejects.toEqual(Errors.CURRENCY_NOT_FOUND(notFound));
  });

  test('should get fee estimation', async () => {
    // Get fee estimation of all currencies
    const feeEstimation = await service.getFeeEstimation();

    expect(feeEstimation).toEqual(new Map<string, number>([
      ['BTC', 2],
      ['LTC', 2],
      [ETHER_SYMBOL, mockGetGasPriceResult],
    ]));

    expect(mockEstimateFee).toHaveBeenCalledTimes(2);
    expect(mockEstimateFee).toHaveBeenNthCalledWith(1, 2);

    expect(mockGetGasPrice).toHaveBeenCalledTimes(1);

    // Get fee estimation for a single currency
    expect(await service.getFeeEstimation('BTC')).toEqual(new Map<string, number>([
      ['BTC', 2],
    ]));

    expect(mockEstimateFee).toHaveBeenCalledTimes(3);
    expect(mockEstimateFee).toHaveBeenNthCalledWith(3, 2);

    // Get fee estimation for a single currency for a specified amount of blocks
    expect(await service.getFeeEstimation('BTC', 5)).toEqual(new Map<string, number>([
      ['BTC', 2],
    ]));

    expect(mockEstimateFee).toHaveBeenCalledTimes(4);
    expect(mockEstimateFee).toHaveBeenNthCalledWith(4, 5);

    // Get fee estimation for an ERC20 token
    expect(await service.getFeeEstimation('USDT')).toEqual(new Map<string, number>([
      [ETHER_SYMBOL, mockGetGasPriceResult],
    ]));

    expect(mockGetGasPrice).toHaveBeenCalledTimes(2);

    // Get fee estimation for a single currency that cannot be found
    const notFound = 'notFound';

    await expect(service.getFeeEstimation(notFound))
      .rejects.toEqual(Errors.CURRENCY_NOT_FOUND(notFound));
  });

  test('should broadcast transactions', async () => {
    // Should broadcast normal transactions
    let transactionHex = 'hex';

    await expect(service.broadcastTransaction('BTC', transactionHex))
      .resolves.toEqual(sendRawTransaction);

    expect(mockSendRawTransaction).toHaveBeenCalledTimes(1);
    expect(mockSendRawTransaction).toHaveBeenCalledWith(transactionHex);

    // Throw special error in case a Swap is refunded before timelock requirement is met
    sendRawTransaction = {
      code: -26,
      message: 'non-mandatory-script-verify-flag (Locktime requirement not satisfied) (code 64)',
    };
    transactionHex = '0100000000010154b6a506a69b5a2e7e8de20fe9aedbe9aa04e3249fc2ca75106a06942c5c84e60000000023220020bcf9f822194145acea0f3235f4107b5bf1a91b6b9f8489f63bf79ec29b360913ffffffff023b622d000000000017a91430897cc6c9d69f6a2c2f1c651d51f22219f1a4f6873ecb2a000000000017a9146ee55aa1c39b0c66acf287ac39721feef49114d6870400483045022100a3269ba08373ed541e91eb9698c4f570c7a8a0fde7dbff503d8c759c59639845022008abe66b6550ffb6484cda8a87140759aa5ee9c4bb2aaa09883d2afab9e6927501483045022100d29199cd9799363fd5869c4e22836c28bf48b2fe1b82bf21fcc23f28abc9921502204b1066a49c2c8d70c876ce28bd9f81aace47c4079b3bae4dfb63173c2f3be21201695221026c8f72b9e63db63907115e65d4da86eaae595b22fdc85ec75301bb4adbf203582103806535be3e3920e5eedee92de5714188fd6a784f2bf7b04f87de0b9c3ae1ecdb21024b23bfdce2afcae7e28c42f7f79aa100f22931712c52d7414a526ba494d44a2553ae00000000';

    const blockDelta = 1;
    mockGetSwapResult = {
      timeoutBlockHeight: blockchainInfo.blocks + blockDelta,
    };

    await expect(service.broadcastTransaction('BTC', transactionHex))
      .rejects.toEqual({
        error: sendRawTransaction.message,
        timeoutBlockHeight: mockGetSwapResult.timeoutBlockHeight,
        timeoutEta: Math.round(new Date().getTime() / 1000) + blockDelta * 10 * 60,
      });

    // Throw Bitcoin Core error in case Swap cannot be found
    mockGetSwapResult = undefined;

    await expect(service.broadcastTransaction('BTC', transactionHex))
      .rejects.toEqual(sendRawTransaction);

    // Throw other Bitcoin Core errors
    sendRawTransaction = {
      code: 1,
      message: 'test',
    };

    await expect(service.broadcastTransaction('BTC', transactionHex))
      .rejects.toEqual(sendRawTransaction);

    // Throw if currency cannot be found
    const notFound = 'notFound';

    await expect(service.broadcastTransaction(notFound, transactionHex))
      .rejects.toEqual(Errors.CURRENCY_NOT_FOUND(notFound));

    sendRawTransaction = 'rawTx';
  });

  test('should add referral', async () => {
    const referral = {
      id: 'adsf',
      feeShare: 25,
      routingNode: '03',
    };

    await service.addReferral(referral);

    expect(mockAddReferral).toHaveBeenCalledTimes(1);
    expect(mockAddReferral).toHaveBeenCalledWith(
      expect.objectContaining(referral),
    );

    // Throw if fee share is not in bounds
    referral.feeShare = -1;

    await expect(service.addReferral(referral))
      .rejects.toEqual(new Error('referral fee share must be between 0 and 100'));

    referral.feeShare = 101;

    await expect(service.addReferral(referral))
      .rejects.toEqual(new Error('referral fee share must be between 0 and 100'));

    // Throw if ID is empty
    referral.id = '';

    await expect(service.addReferral(referral))
      .rejects.toEqual(new Error('referral IDs cannot be empty'));
  });

  // TODO: add channel creations
  test('should create swaps', async () => {
    mockGetSwapResult = undefined;

    const pair = 'BTC/BTC';
    const orderSide = 'buy';
    const referralId = 'referral';
    const refundPublicKey = getHexBuffer('0xfff');
    const preimageHash = getHexBuffer('ac3703b99248a0a2d948c6021fdd70debb90ab37233e62531c7f900fe3852c89');

    // Create a new swap
    let emittedId = '';

    service.eventHandler.once('swap.update', (id, message) => {
      expect(message).toEqual({ status: SwapUpdateEvent.SwapCreated });
      emittedId = id;
    });

    const response = await service.createSwap({
      orderSide,
      referralId,
      preimageHash,
      refundPublicKey,
      pairId: pair,
    });

    expect(emittedId).toEqual(response.id);
    expect(response).toEqual({
      id: mockedSwap.id,
      address: mockedSwap.address,
      redeemScript: mockedSwap.redeemScript,
      timeoutBlockHeight: mockedSwap.timeoutBlockHeight,
    });

    expect(mockGetSwap).toHaveBeenCalledTimes(1);
    expect(mockGetSwap).toHaveBeenCalledWith({
      preimageHash: getHexString(preimageHash),
    });

    expect(mockCreateSwap).toHaveBeenCalledTimes(1);
    expect(mockCreateSwap).toHaveBeenCalledWith({
      referralId,
      preimageHash,
      refundPublicKey,
      baseCurrency: 'BTC',
      quoteCurrency: 'BTC',
      timeoutBlockDelta: 1,
      orderSide: OrderSide.BUY,
    });

    // Throw if swap with preimage exists already
    mockGetSwapResult = {};
    await expect(service.createSwap({
      pairId: '',
      orderSide: '',
      preimageHash: Buffer.alloc(0),
    })).rejects.toEqual(Errors.SWAP_WITH_PREIMAGE_EXISTS());
  });

  test('should get swap rates', async () => {
    const id = 'id';

    mockGetSwapResult = {
      rate: 1,
      pair: 'BTC/BTC',
      orderSide: OrderSide.BUY,
      onchainAmount: 1000000,
    };

    const response = await service.getSwapRates(id);

    expect(response).toEqual({
      onchainAmount: mockGetSwapResult.onchainAmount,
      submarineSwap: {
        invoiceAmount: Math.floor((mockGetSwapResult.onchainAmount - mockGetBaseFeeResult) / (1 + mockGetPercentageFeeResult)),
      },
    });

    // Throw if onchain amount is not set
    mockGetSwapResult = {};
    await expect(service.getSwapRates(id)).rejects.toEqual(Errors.SWAP_NO_LOCKUP());

    // Throw if the Swap cannot be found
    mockGetSwapResult = undefined;
    await expect(service.getSwapRates(id)).rejects.toEqual(Errors.SWAP_NOT_FOUND(id));
  });

  test('should set invoices of swaps', async () => {
    mockGetSwapResult = {
      id: 'invoiceId',
      pair: 'BTC/BTC',
      orderSide: 0,
      lockupAddress: 'bcrt1qae5nuz2cv7gu2dpps8rwrhsfv6tjkyvpd8hqsu',
    };

    const invoiceAmount = 100000;
    const invoice = 'lnbcrt1m1pw5qjj2pp5fzncpqa5hycqppwvelygawz2jarnxnngry945mm3uv6janpjfvgqdqqcqzpg35dc9zwwu3jhww7q087fc8h6tjs2he6w0yulc3nz262waznvp2s5t9xlwgau2lzjl8zxjlt5jxtgkamrz2e4ct3d70azmkh2hhgddkgpg38yqt';

    let emittedId = '';

    service.eventHandler.once('swap.update', (id, message) => {
      expect(message).toEqual({ status: SwapUpdateEvent.InvoiceSet });
      emittedId = id;
    });

    const response = await service.setSwapInvoice(mockGetSwapResult.id, invoice);

    expect(emittedId).toEqual(mockGetSwapResult.id);
    expect(response).toEqual({
      acceptZeroConf: true,
      expectedAmount: 100002,
      bip21: 'bitcoin:bcrt1qae5nuz2cv7gu2dpps8rwrhsfv6tjkyvpd8hqsu?amount=0.00100002&label=Send%20to%20BTC%20lightning',
    });

    expect(mockGetSwap).toHaveBeenCalledTimes(1);
    expect(mockGetSwap).toHaveBeenCalledWith({
      id: mockGetSwapResult.id,
    });

    expect(mockGetFees).toHaveBeenCalledTimes(1);
    expect(mockGetFees).toHaveBeenCalledWith(mockGetSwapResult.pair, 1, mockGetSwapResult.orderSide, invoiceAmount, BaseFeeType.NormalClaim);

    expect(mockAcceptZeroConf).toHaveBeenCalledTimes(1);
    expect(mockAcceptZeroConf).toHaveBeenCalledWith('BTC', invoiceAmount + 2);

    expect(mockSetSwapInvoice).toHaveBeenCalledTimes(1);
    expect(mockSetSwapInvoice).toHaveBeenCalledWith(mockGetSwapResult, invoice, invoiceAmount + 2, 1, true, expect.anything());

    // Should execute with valid pair hash (it should just not throw)
    await service.setSwapInvoice(mockGetSwapResult.id, invoice, pairs.get('BTC/BTC')!.hash);

    // Throw when an invalid pair hash is provided
    await expect(service.setSwapInvoice(mockGetSwapResult.id, invoice, 'wrongHash'))
      .rejects.toEqual(Errors.INVALID_PAIR_HASH());
    await expect(service.setSwapInvoice(mockGetSwapResult.id, invoice, ''))
      .rejects.toEqual(Errors.INVALID_PAIR_HASH());

    // Throw if a swap doesn't respect the limits
    const invoiceLimit = 'lnbcrt1p0xdz2epp59nrc7lqcnw37suzed83e8s33sxl9p0hk4xu6gya9rcxfmnzd8jfsdqqcqzpgsp5228z07nxfghfzf3p2lu7vc03zss8cgklql845yjr990zsa3nj2hq9qy9qsqqpw8n4s5v3w7t9rryccz46f5v0542td098dun4yzfru4saxhd5apcxl5clxn8a70afn7j3e6avvk3s9gn3ypt2revyuh47aftft3kpcpek9lma';
    const invoiceLimitAmount = 0;

    await expect(service.setSwapInvoice(mockGetSwapResult.id, invoiceLimit))
      .rejects.toEqual(Errors.BENEATH_MINIMAL_AMOUNT(invoiceLimitAmount, 1));

    // Throw if swap with id does not exist
    mockGetSwapResult = undefined;
    const notFoundId = 'asdfasdf';

    await expect(service.setSwapInvoice(notFoundId, ''))
      .rejects.toEqual(Errors.SWAP_NOT_FOUND(notFoundId));

    // Throw if invoice is already set
    mockGetSwapResult = {
      invoice: 'invoice',
    };

    await expect(service.setSwapInvoice(mockGetSwapResult.id, ''))
      .rejects.toEqual(Errors.SWAP_HAS_INVOICE_ALREADY(mockGetSwapResult.id));
  });

  // TODO: channel creation logic
  test('should create swaps with invoices', async () => {
    const createSwapResult = {
      id: 'swapInvoice',
      address: 'bcrt1qundqmnml8644l23g7cr3fjnksks4nc6mxf4gk9',
      redeemScript: getHexBuffer('a914e3be605a911034ca6fc38ae3a027bf374d37be708763210288ff09ee16a91183fd42afa8329a7b4387e5e61e5c66c6eb43058008c95136c56702fc00b1752103e25b3f3bb7f9978410d52b4c763e3c8fe6d43cf462e91138c5b0f61b92c93d7068ac'),
      timeoutBlockHeight: 504893,
    };

    const setSwapInvoiceResult = {
      acceptZeroConf: true,
      expectedAmount: 100002,
      bip21: 'bitcoin:bcrt1qundqmnml8644l23g7cr3fjnksks4nc6mxf4gk9?amount=0.00100002&label=Send%20to%20BTC%20lightning',
    };

    // Inject mocks into the service
    service.createSwap = jest.fn().mockResolvedValue(createSwapResult);
    service.setSwapInvoice = jest.fn().mockResolvedValue(setSwapInvoiceResult);

    mockGetSwapResult = undefined;

    const pair = 'BTC/BTC';
    const orderSide = 'sell';
    const referralId = 'referral';
    const refundPublicKey = getHexBuffer('02d3727f1c2017adf58295378d02ace4c514666b8d75d4751940b940718ceb34ed');
    const invoice = 'lnbcrt1m1p0xdry7pp5jadnlr9y5qs5nl93u06v9w2azqr8rf5n09u2wk0c6jktyfxwfpwqdqqcqzpgsp5svss08dmgw9q6emmwfzp74hcs2rq2fu3u78qge5l942al5glzjmq9qy9qsq4v5x0qlfp3fvpm9mrzmmdrptwdrd7gxyaypz4y0g8l8apmzfjgvqtxg9z89y0kg2lh6ykd8czt5ven6nlvr407vdm0mp9l9tvhg33gspv3yr0j';

    const response = await service.createSwapWithInvoice(
      pair,
      orderSide,
      refundPublicKey,
      invoice,
      undefined,
      referralId,
    );

    expect(response).toEqual({
      ...createSwapResult,
      ...setSwapInvoiceResult,
    });

    expect(service.createSwap).toHaveBeenCalledTimes(1);
    expect(service.createSwap).toHaveBeenCalledWith({
      orderSide,
      referralId,
      refundPublicKey,
      pairId: pair,
      preimageHash: getHexBuffer(decodeInvoice(invoice).paymentHash!),
    });

    expect(service.setSwapInvoice).toHaveBeenCalledTimes(1);
    expect(service.setSwapInvoice).toHaveBeenCalledWith(
      response.id,
      invoice,
      undefined,
    );

    // Throw and remove the database entry if "setSwapInvoice" fails
    const error = {
      message: 'error thrown by Service',
    };

    const mockDestroySwap = jest.fn().mockResolvedValue({});
    const mockDestroyChannelCreation = jest.fn().mockResolvedValue({});
    service.setSwapInvoice = jest.fn().mockImplementation(async () => {
      mockGetSwapResult = {
        destroy: mockDestroySwap,
      };
      mockGetChannelCreationResult = {
        destroy: mockDestroyChannelCreation,
      };

      throw error;
    });

    await expect(service.createSwapWithInvoice(pair, orderSide, refundPublicKey, invoice))
      .rejects.toEqual(error);

    expect(mockDestroySwap).toHaveBeenCalledTimes(1);
    expect(mockDestroyChannelCreation).toHaveBeenCalledTimes(1);

    // Throw if swap with invoice exists already
    mockGetSwapResult = {};

    await expect(service.createSwapWithInvoice('', '', Buffer.alloc(0), ''))
      .rejects.toEqual(Errors.SWAP_WITH_INVOICE_EXISTS());
  });

  test('should create reverse swaps', async () => {
    service.allowReverseSwaps = true;

    let pair = 'BTC/BTC';
    const orderSide = 'buy';
    const invoiceAmount = 100000;
    const preimageHash = randomBytes(32);
    const claimPublicKey = getHexBuffer('0xfff');

    const onchainAmount = invoiceAmount * (1 - mockGetPercentageFeeResult) - mockGetBaseFeeResult;

    let emittedId = '';

    service.eventHandler.once('swap.update', (id, message) => {
      expect(message).toEqual({ status: SwapUpdateEvent.SwapCreated });
      emittedId = id;
    });

    const response = await service.createReverseSwap({
      orderSide,
      preimageHash,
      invoiceAmount,
      claimPublicKey,
      pairId: pair,
    });

    expect(emittedId).toEqual(response.id);
    expect(response).toEqual({
      onchainAmount,
      id: mockedReverseSwap.id,
      invoice: mockedReverseSwap.invoice,
      redeemScript: mockedReverseSwap.redeemScript,
      lockupAddress: mockedReverseSwap.lockupAddress,
      timeoutBlockHeight: mockedReverseSwap.timeoutBlockHeight,
    });

    expect(mockGetPercentageFee).toHaveBeenCalledTimes(1);
    expect(mockGetPercentageFee).toHaveBeenCalledWith(pair);

    expect(mockGetBaseFee).toHaveBeenCalledTimes(1);
    expect(mockGetBaseFee).toHaveBeenCalledWith('BTC', BaseFeeType.ReverseLockup);

    expect(mockCreateReverseSwap).toHaveBeenCalledTimes(1);
    expect(mockCreateReverseSwap).toHaveBeenCalledWith({
      preimageHash,
      onchainAmount,
      claimPublicKey,
      baseCurrency: 'BTC',
      quoteCurrency: 'BTC',
      orderSide: OrderSide.BUY,
      onchainTimeoutBlockDelta: 1,
      lightningTimeoutBlockDelta: 4,
      holdInvoiceAmount: invoiceAmount,
      percentageFee: invoiceAmount * mockGetPercentageFeeResult,
    });

    // Should add a 10% buffer to the lightning timeout block delta for cross chain swaps
    pair = 'LTC/BTC';
    const pairRate = 1 / pairs.get(pair)!.rate;
    const percentageFee = invoiceAmount * pairRate * mockGetPercentageFeeResult;

    await service.createReverseSwap({
      orderSide,
      preimageHash,
      invoiceAmount,
      claimPublicKey,
      pairId: pair,
    });

    expect(mockCreateReverseSwap).toHaveBeenCalledTimes(2);
    expect(mockCreateReverseSwap).toHaveBeenNthCalledWith(2, {
      preimageHash,
      percentageFee,
      claimPublicKey,
      baseCurrency: 'LTC',
      quoteCurrency: 'BTC',
      orderSide: OrderSide.BUY,
      onchainTimeoutBlockDelta: 160,
      lightningTimeoutBlockDelta: 44,
      holdInvoiceAmount: invoiceAmount,
      onchainAmount: invoiceAmount * pairRate - percentageFee - mockGetBaseFeeResult,
    });

    pair = 'BTC/BTC';

    // Should execute with valid pair hash (it should just not throw)
    await service.createReverseSwap({
      orderSide,
      preimageHash,
      invoiceAmount,
      claimPublicKey,
      pairId: pair,
      pairHash: pairs.get(pair)!.hash,
    });

    // Throw when an invalid pair hash is provided
    await expect(service.createReverseSwap({
      orderSide,
      preimageHash,
      invoiceAmount,
      claimPublicKey,
      pairId: pair,
      pairHash: 'wrongHash',
    })).rejects.toEqual(Errors.INVALID_PAIR_HASH());
    await expect(service.createReverseSwap({
      orderSide,
      preimageHash,
      invoiceAmount,
      claimPublicKey,
      pairId: pair,
      pairHash: '',
    })).rejects.toEqual(Errors.INVALID_PAIR_HASH());

    // Throw if the onchain amount is less than 1
    await expect(service.createReverseSwap({
      orderSide,
      preimageHash,
      claimPublicKey,
      pairId: pair,
      invoiceAmount: 1,
    })).rejects.toEqual(Errors.ONCHAIN_AMOUNT_TOO_LOW());

    // Throw if a reverse swaps doesn't respect the limits
    const invoiceAmountLimit = 0;

    await expect(service.createReverseSwap({
      orderSide,
      preimageHash,
      claimPublicKey,
      pairId: pair,
      invoiceAmount: invoiceAmountLimit,
    })).rejects.toEqual(Errors.BENEATH_MINIMAL_AMOUNT(invoiceAmountLimit, 1));

    // Throw if reverse swaps are disabled
    service.allowReverseSwaps = false;

    await expect(service.createReverseSwap({
      orderSide,
      preimageHash,
      invoiceAmount,
      claimPublicKey,
      pairId: pair,
    })).rejects.toEqual(Errors.REVERSE_SWAPS_DISABLED());

    service.allowReverseSwaps = true;

    const invalidNumber = 3.141;

    // Throw if invoice amount is not a whole number
    await expect(service.createReverseSwap({
      orderSide,
      preimageHash,
      claimPublicKey,
      pairId: pair,
      invoiceAmount: invalidNumber,
    })).rejects.toEqual(Errors.NOT_WHOLE_NUMBER(invalidNumber));

    // Throw if onchain amount is not a whole number
    await expect(service.createReverseSwap({
      orderSide,
      preimageHash,
      claimPublicKey,
      pairId: pair,
      onchainAmount: invalidNumber,
    })).rejects.toEqual(Errors.NOT_WHOLE_NUMBER(invalidNumber));
  });

  test('should create Reverse Swaps with referral IDs', async () => {
    const pair = 'BTC/BTC';
    const orderSide = 'buy';
    const invoiceAmount = 100000;
    const referralId = 'referral';
    const preimageHash = randomBytes(32);
    const claimPublicKey = getHexBuffer('0xfff');

    const onchainAmount = invoiceAmount * (1 - mockGetPercentageFeeResult) - mockGetBaseFeeResult;

    await service.createReverseSwap({
      orderSide,
      referralId,
      preimageHash,
      invoiceAmount,
      claimPublicKey,
      pairId: pair,
    });

    expect(mockCreateReverseSwap).toHaveBeenCalledWith({
      referralId,
      preimageHash,
      onchainAmount,
      claimPublicKey,
      baseCurrency: 'BTC',
      quoteCurrency: 'BTC',
      orderSide: OrderSide.BUY,
      onchainTimeoutBlockDelta: 1,
      lightningTimeoutBlockDelta: 4,
      holdInvoiceAmount: invoiceAmount,
      percentageFee: invoiceAmount * mockGetPercentageFeeResult,
    });
  });

  test('should create Reverse Swaps with specified onchain amount', async () => {
    service.allowReverseSwaps = true;

    const pair = 'BTC/BTC';
    const orderSide = 'buy';
    const onchainAmount = 97680;
    const preimageHash = randomBytes(32);
    const claimPublicKey = getHexBuffer('0xfff');

    const invoiceAmount = (onchainAmount + mockGetBaseFeeResult) / (1 - mockGetPercentageFeeResult);
    const percentageFee = invoiceAmount * mockGetPercentageFeeResult;

    await service.createReverseSwap({
      orderSide,
      preimageHash,
      onchainAmount,
      claimPublicKey,
      pairId: pair,
    });

    expect(mockCreateReverseSwap).toHaveBeenCalledWith({
      preimageHash,
      onchainAmount,
      percentageFee,
      claimPublicKey,
      baseCurrency: 'BTC',
      quoteCurrency: 'BTC',
      orderSide: OrderSide.BUY,
      holdInvoiceAmount: invoiceAmount,
      onchainTimeoutBlockDelta: expect.anything(),
      lightningTimeoutBlockDelta: expect.anything(),
    });
  });

  test('should create prepay miner fee reverse swaps', async () => {
    service['prepayMinerFee'] = true;

    const pair = 'BTC/BTC';
    const orderSide = 'buy';
    const invoiceAmount = 100000;
    const onchainAmount = invoiceAmount * (1 - mockGetPercentageFeeResult) - mockGetBaseFeeResult;
    const preimageHash = randomBytes(32);
    const claimPublicKey = getHexBuffer('0xfff');

    const response = await service.createReverseSwap({
      orderSide,
      preimageHash,
      invoiceAmount,
      claimPublicKey,
      pairId: pair,
    });

    expect(response).toEqual({
      onchainAmount,
      id: mockedReverseSwap.id,
      invoice: mockedReverseSwap.invoice,
      redeemScript: mockedReverseSwap.redeemScript,
      lockupAddress: mockedReverseSwap.lockupAddress,
      minerFeeInvoice: mockedReverseSwap.minerFeeInvoice,
      timeoutBlockHeight: mockedReverseSwap.timeoutBlockHeight,
    });

    expect(mockCreateReverseSwap).toHaveBeenCalledTimes(1);
    expect(mockCreateReverseSwap).toHaveBeenCalledWith({
      preimageHash,
      onchainAmount,
      claimPublicKey,
      baseCurrency: 'BTC',
      quoteCurrency: 'BTC',
      orderSide: OrderSide.BUY,
      onchainTimeoutBlockDelta: 1,
      lightningTimeoutBlockDelta: 4,
      prepayMinerFeeInvoiceAmount: mockGetBaseFeeResult,
      holdInvoiceAmount: invoiceAmount - mockGetBaseFeeResult,
      percentageFee: invoiceAmount * mockGetPercentageFeeResult,
    });

    service['prepayMinerFee'] = false;
  });

  test('should create Reverse Swaps with Ethereum prepay miner fee', async () => {
    const args = {
      pairId: 'rBTC/BTC',
      orderSide: 'buy',
      prepayMinerFee: true,
      invoiceAmount: 100000,
      preimageHash: randomBytes(32),
      claimAddress: '0x00000000219ab540356cbb839cbe05303d7705fa',
    } as any;

    const response = await service.createReverseSwap(args);

    const pairRate = 1 / pairs.get(args.pairId)!.rate;
    const percentageFee = Math.ceil(pairRate * args.invoiceAmount * mockGetPercentageFeeResult);
    const onchainAmount = Math.floor(pairRate * args.invoiceAmount - percentageFee - mockGetBaseFeeResult) - response.prepayMinerFeeAmount!;

    const prepayMinerFeeOnchainAmount = ethereumPrepayMinerFeeGasLimit.mul(mockGetGasPriceResult).mul(gweiDecimals).div(etherDecimals).toNumber();
    const prepayMinerFeeInvoiceAmount = prepayMinerFeeOnchainAmount * (1 / pairRate);

    expect(response).toEqual({
      onchainAmount,
      id: mockedReverseSwap.id,
      invoice: mockedReverseSwap.invoice,
      redeemScript: mockedReverseSwap.redeemScript,
      lockupAddress: mockedReverseSwap.lockupAddress,
      prepayMinerFeeAmount: prepayMinerFeeOnchainAmount,
      minerFeeInvoice: mockedReverseSwap.minerFeeInvoice,
      timeoutBlockHeight: mockedReverseSwap.timeoutBlockHeight,
    });

    expect(mockCalculateRate).toHaveBeenCalledTimes(1);
    expect(mockCalculateRate).toHaveBeenCalledWith(ETHER_SYMBOL, 'BTC');

    expect(mockCreateReverseSwap).toHaveBeenCalledTimes(1);
    expect(mockCreateReverseSwap).toHaveBeenCalledWith({
      onchainAmount,
      percentageFee,
      prepayMinerFeeOnchainAmount,
      prepayMinerFeeInvoiceAmount,
      baseCurrency: ETHER_SYMBOL,
      quoteCurrency: 'BTC',
      orderSide: OrderSide.BUY,
      onchainTimeoutBlockDelta: 720,
      lightningTimeoutBlockDelta: 20,
      claimAddress: args.claimAddress,
      preimageHash: args.preimageHash,
      holdInvoiceAmount: args.invoiceAmount - prepayMinerFeeInvoiceAmount,
    });

    // Throw if the sending currency is Bitcoin like
    args.pairId = 'BTC/BTC';
    args.claimPublicKey = '03ecb98dc3f82af3efac152f3c5692548754df047042dcb89620fc72fd3ea479ab';

    await expect(service.createReverseSwap(args)).rejects
      .toEqual(ApiErrors.UNSUPPORTED_PARAMETER('BTC', 'prepayMinerFee'));
  });

  test('should create Reverse Swaps with Ethereum prepay miner fee and specified onchain amount', async () => {
    const args = {
      pairId: 'rBTC/BTC',
      orderSide: 'buy',
      prepayMinerFee: true,
      onchainAmount: 3200000000,
      preimageHash: randomBytes(32),
      claimAddress: '0x00000000219ab540356cbb839cbe05303d7705fa',
    } as any;

    await service.createReverseSwap(args);

    const pairRate = 1 / pairs.get(args.pairId)!.rate;
    const invoiceAmount = Math.ceil(((args.onchainAmount + mockGetBaseFeeResult) / pairRate) / (1 - mockGetPercentageFeeResult));

    const prepayMinerFeeOnchainAmount = ethereumPrepayMinerFeeGasLimit.mul(mockGetGasPriceResult).mul(gweiDecimals).div(etherDecimals).toNumber();
    const prepayMinerFeeInvoiceAmount = prepayMinerFeeOnchainAmount * (1 / pairRate);

    expect(mockCreateReverseSwap).toHaveBeenCalledWith({
      prepayMinerFeeOnchainAmount,
      prepayMinerFeeInvoiceAmount,
      baseCurrency: ETHER_SYMBOL,
      quoteCurrency: 'BTC',
      orderSide: OrderSide.BUY,
      claimAddress: args.claimAddress,
      preimageHash: args.preimageHash,
      holdInvoiceAmount: invoiceAmount,
      onchainAmount: args.onchainAmount,
      onchainTimeoutBlockDelta: expect.anything(),
      lightningTimeoutBlockDelta: expect.anything(),
      percentageFee: Math.ceil(invoiceAmount * pairRate * mockGetPercentageFeeResult),
    });
  });

  test('should pay invoices', async () => {
    const symbol = 'BTC';
    const invoice = 'invoice';

    const response = await service.payInvoice(symbol, invoice);

    expect(mockSendPayment).toBeCalledTimes(1);
    expect(mockSendPayment).toBeCalledWith(invoice);

    expect(response).toEqual(await mockSendPayment());
  });

  test('should send BTC', async () => {
    const fee = 3;
    const amount = 1;
    const symbol = 'BTC';
    const address = 'bcrt1qmv7axanlc090h2j79ufg530eaw88w8rfglnjl3';

    let sendAll = false;

    const response = await service.sendCoins({
      fee,
      amount,
      symbol,
      address,
      sendAll,
    });

    expect(response).toEqual({
      vout: mockTransaction.vout,
      transactionId: mockTransaction.transaction.getId(),
    });

    expect(mockSendToAddress).toHaveBeenCalledTimes(1);
    expect(mockSendToAddress).toHaveBeenCalledWith(
      address,
      amount,
      fee,
    );

    // Should sweep the wallet
    sendAll = true;

    const sweepResponse = await service.sendCoins({
      fee,
      amount,
      symbol,
      address,
      sendAll,
    });

    expect(sweepResponse).toEqual({
      vout: mockTransaction.vout,
      transactionId: mockTransaction.transaction.getId(),
    });

    expect(mockSweepWallet).toHaveBeenCalledTimes(1);
    expect(mockSweepWallet).toHaveBeenCalledWith(
      address,
      fee,
    );
  });

  test('should send Ether', async () => {
    const fee = 3;
    const amount = 2;
    const symbol = ETHER_SYMBOL;
    const address = '0x0000000000000000000000000000000000000000';

    let sendAll = false;

    const response = await service.sendCoins({
      fee,
      amount,
      symbol,
      address,
      sendAll,
    });

    expect(response).toEqual({
      transactionId: etherTransaction.transactionId,
    });

    expect(mockSendEther).toHaveBeenCalledTimes(1);
    expect(mockSendEther).toHaveBeenCalledWith(address, amount, fee);

    // Should sweep wallet
    sendAll = true;

    const sweepResponse = await service.sendCoins({
      fee,
      amount,
      symbol,
      address,
      sendAll,
    });

    expect(sweepResponse).toEqual({
      transactionId: etherTransaction.transactionId,
    });

    expect(mockSweepEther).toHaveBeenCalledTimes(1);
    expect(mockSweepEther).toHaveBeenCalledWith(address, fee);
  });

  test('should send ERC20 tokens', async () => {
    const fee = 3;
    const amount = 2;
    const symbol = 'TRC';
    const address = '0x0000000000000000000000000000000000000000';

    let sendAll = false;

    const response = await service.sendCoins({
      fee,
      amount,
      symbol,
      address,
      sendAll,
    });

    expect(response).toEqual({
      transactionId: tokenTransaction.transactionId,
    });

    expect(mockSendToken).toHaveBeenCalledTimes(1);
    expect(mockSendToken).toHaveBeenCalledWith(address, amount, fee);

    // Should sweep wallet
    sendAll = true;

    const sweepResponse = await service.sendCoins({
      fee,
      amount,
      symbol,
      address,
      sendAll,
    });

    expect(sweepResponse).toEqual({
      transactionId: tokenTransaction.transactionId,
    });

    expect(mockSweepToken).toHaveBeenCalledTimes(1);
    expect(mockSweepToken).toHaveBeenCalledWith(address, fee);
  });

  test('should throw of currency to send cannot be found', async () => {
    const notFound = 'notFound';

    await expect(service.sendCoins({
      fee: 0,
      amount: 0,
      address: '',
      sendAll: false,
      symbol: notFound,
    })).rejects.toEqual(Errors.CURRENCY_NOT_FOUND(notFound));
  });

  test('should get referral IDs', async () => {
    const getReferralId = service['getReferralId'];

    const id = 'id';
    const routingNode = '03';

    expect(await getReferralId(id)).toEqual(id);
    expect(await getReferralId(id, routingNode)).toEqual(id);

    referralByRoutingNode = { id };
    expect(await getReferralId(undefined, routingNode)).toEqual(id);

    expect(mockGetReferralByRoutingNode).toHaveBeenCalledTimes(1);
    expect(mockGetReferralByRoutingNode).toHaveBeenCalledWith(routingNode);
  });

  test('should verify amounts', () => {
    const rate = 2;
    const verifyAmount = service['verifyAmount'];

    // Normal swaps
    verifyAmount('test', rate, 5, OrderSide.BUY, false);
    verifyAmount('test', rate, 10, OrderSide.SELL, false);

    expect(() => verifyAmount('test', rate, 1.5, OrderSide.BUY, false)).toThrow(
      Errors.BENEATH_MINIMAL_AMOUNT(3, 5).message,
    );
    expect(() => verifyAmount('test', rate, 12, OrderSide.SELL, false)).toThrow(
      Errors.EXCEED_MAXIMAL_AMOUNT(12, 10).message,
    );

    // Reverse swaps
    verifyAmount('test', rate, 10, OrderSide.BUY, true);
    verifyAmount('test', rate, 5, OrderSide.SELL, true);

    expect(() => verifyAmount('test', rate, 1.5, OrderSide.BUY, true)).toThrow(
      Errors.BENEATH_MINIMAL_AMOUNT(1.5, 5).message,
    );
    expect(() => verifyAmount('test', rate, 12, OrderSide.SELL, true)).toThrow(
      Errors.EXCEED_MAXIMAL_AMOUNT(24, 10).message,
    );

    // Throw if limits of pair cannot be found
    const notFound = 'notFound';

    expect(() => verifyAmount(notFound, 0, 0, OrderSide.BUY, false)).toThrow(
      Errors.PAIR_NOT_FOUND(notFound).message,
    );
  });

  test('should calculate invoice amounts', () => {
    const calculateInvoiceAmount = service['calculateInvoiceAmount'];

    expect(calculateInvoiceAmount(OrderSide.BUY, 1, 1000000, 210, 0.02)).toEqual(980186);
    expect(calculateInvoiceAmount(OrderSide.SELL, 1, 1000000, 210, 0.02)).toEqual(980186);

    expect(calculateInvoiceAmount(OrderSide.BUY, 0.005, 1000000, 120, 0.05)).toEqual(190453333);
    expect(calculateInvoiceAmount(OrderSide.SELL, 0.005, 1000000, 120, 0.05)).toEqual(4761);
  });

  test('should get pair', () => {
    const getPair = service['getPair'];

    expect(getPair('BTC/BTC')).toEqual({
      base: 'BTC',
      quote: 'BTC',
      ...pairs.get('BTC/BTC'),
    });

    // Throw if pair cannot be found
    const notFound = 'notFound';

    expect(() => getPair(notFound)).toThrow(
      Errors.PAIR_NOT_FOUND(notFound).message,
    );
  });

  test('should get currency', () => {
    const getCurrency = service['getCurrency'];

    expect(getCurrency('BTC')).toEqual(
      currencies.get('BTC'),
    );

    // Throw if currency cannot be found
    const notFound = 'notFound';

    expect(() => getCurrency(notFound)).toThrow(
      Errors.CURRENCY_NOT_FOUND(notFound).message ,
    );
  });

  test('should get order side', () => {
    const getOrderSide = service['getOrderSide'];

    expect(getOrderSide('buy')).toEqual(OrderSide.BUY);
    expect(getOrderSide('sell')).toEqual(OrderSide.SELL);

    // Throw if order side cannot be found
    expect(() => getOrderSide('')).toThrow(Errors.ORDER_SIDE_NOT_FOUND('').message);
  });

  test('should calculate timeout date', () => {
    const calculateTimeoutDate = service['calculateTimeoutDate'];

    expect(calculateTimeoutDate('BTC', 3)).toEqual(Math.round(new Date().getTime() / 1000) + 3 * 10 * 60);
    expect(calculateTimeoutDate('LTC', 7)).toEqual(Math.round(new Date().getTime() / 1000) + 7 * 2.5 * 60);
  });
});
