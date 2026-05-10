import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { ReturnAbstractRepository } from './infrastructure/persistence/return.abstract.repository';
import { OrderAbstractRepository } from '../orders/infrastructure/persistence/order.abstract.repository';
import { FilesService } from '../files/files.service';
import { VendorsService } from '../vendors/vendors.service';
import { Return } from './domain/return';
import { ReturnReason, ReturnStatus } from './domain/return-enums';
import { Order } from '../orders/domain/order';
import { SubOrderFulfillmentStatus } from '../orders/domain/order-enums';

describe('ReturnsService', () => {
  let service: ReturnsService;
  let returnsRepo: jest.Mocked<ReturnAbstractRepository>;
  let ordersRepo: jest.Mocked<OrderAbstractRepository>;
  let filesService: jest.Mocked<FilesService>;
  let vendorsService: jest.Mocked<VendorsService>;

  const NOW = new Date('2026-05-15T10:00:00Z');
  const DELIVERED_AT = new Date('2026-05-10T12:00:00Z'); // 5 days ago
  const RETURN_WINDOW_DAYS = 7;

  const mockOrder = (overrides?: Partial<Order>): Order => {
    const order = new Order();
    order.id = 'order-1';
    order.buyerId = 100;
    order.subOrders = [
      {
        id: 'so-1',
        vendorId: 'vendor-1',
        fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
        deliveredAt: DELIVERED_AT,
        items: [
          {
            id: 'oi-1',
            variantId: 'var-1',
            quantity: 2,
            unitPriceSnapshot: '5000',
          },
        ],
      } as never,
    ] as never;
    return Object.assign(order, overrides);
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);

    returnsRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      listForBuyer: jest.fn(),
      listForVendor: jest.fn(),
      listForAdmin: jest.fn(),
      sumNonRejectedQuantitiesByOrderItem: jest
        .fn()
        .mockResolvedValue(new Map()),
      sumClosedQuantitiesByOrderItem: jest.fn().mockResolvedValue(new Map()),
      markApproved: jest.fn(),
      markRejected: jest.fn(),
      markShippedBack: jest.fn(),
      markReceived: jest.fn(),
      markRefunded: jest.fn(),
      markClosed: jest.fn(),
    } as unknown as jest.Mocked<ReturnAbstractRepository>;

    ordersRepo = {
      findHydratedById: jest.fn(),
      findOrderIdForSubOrder: jest.fn(),
      flipSubOrderToReturnedIfDelivered: jest.fn(),
    } as unknown as jest.Mocked<OrderAbstractRepository>;

    filesService = {
      findByIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<FilesService>;

    vendorsService = {
      getById: jest.fn().mockResolvedValue({
        id: 'vendor-1',
        returnWindowDays: RETURN_WINDOW_DAYS,
      }),
    } as unknown as jest.Mocked<VendorsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: ReturnAbstractRepository, useValue: returnsRepo },
        { provide: OrderAbstractRepository, useValue: ordersRepo },
        { provide: FilesService, useValue: filesService },
        { provide: VendorsService, useValue: vendorsService },
      ],
    }).compile();
    service = moduleRef.get(ReturnsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    beforeEach(() => {
      ordersRepo.findHydratedById.mockResolvedValue(mockOrder());
      filesService.findByIds.mockResolvedValue([]);
      const created = new Return();
      created.id = 'r-1';
      created.status = ReturnStatus.REQUESTED;
      returnsRepo.create.mockResolvedValue(created);
    });

    it('should create return for delivered sub-order within window', async () => {
      const result = await service.create({
        buyerId: 100,
        orderId: 'order-1',
        subOrderId: 'so-1',
        items: [{ orderItemId: 'oi-1', quantity: 1 }],
        reason: ReturnReason.DAMAGED,
      });
      expect(result.id).toBe('r-1');
      expect(returnsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subOrderId: 'so-1',
          buyerId: 100,
          vendorId: 'vendor-1',
          reason: ReturnReason.DAMAGED,
          totalRefundMinor: '5000', // 1 × 5000
          items: [
            expect.objectContaining({
              orderItemId: 'oi-1',
              quantity: 1,
              refundAmountMinor: '5000',
            }),
          ],
          attachmentFileIds: [],
        }),
      );
    });

    it('should reject return when sub-order not delivered', async () => {
      ordersRepo.findHydratedById.mockResolvedValue(
        mockOrder({
          subOrders: [
            {
              id: 'so-1',
              vendorId: 'vendor-1',
              fulfillmentStatus:
                SubOrderFulfillmentStatus.AWAITING_CONFIRMATION,
              deliveredAt: null,
              items: [
                {
                  id: 'oi-1',
                  variantId: 'var-1',
                  quantity: 2,
                  unitPriceSnapshot: '5000',
                },
              ],
            },
          ] as never,
        }),
      );
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should reject return when window expired', async () => {
      ordersRepo.findHydratedById.mockResolvedValue(
        mockOrder({
          subOrders: [
            {
              id: 'so-1',
              vendorId: 'vendor-1',
              fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
              deliveredAt: new Date('2026-05-01T00:00:00Z'), // 14 days ago, > 7-day window
              items: [
                {
                  id: 'oi-1',
                  variantId: 'var-1',
                  quantity: 2,
                  unitPriceSnapshot: '5000',
                },
              ],
            },
          ] as never,
        }),
      );
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(/window/i);
    });

    it('should reject return when buyer is not the order buyer', async () => {
      await expect(
        service.create({
          buyerId: 999, // different buyer
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject when item quantity exceeds ordered quantity', async () => {
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 3 }], // ordered only 2
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(/quantity/i);
    });

    it('should reject when cumulative open returns exceed ordered quantity', async () => {
      // 1 already in non-rejected RMA. Buyer wants to return 2 more. ordered=2, total would be 3.
      returnsRepo.sumNonRejectedQuantitiesByOrderItem.mockResolvedValue(
        new Map([['oi-1', 1]]),
      );
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 2 }],
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(/quantity/i);
    });

    it('should reject reason=OTHER without reasonNote', async () => {
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.OTHER,
        }),
      ).rejects.toThrow(/reasonNote/i);
    });

    it('should accept reason=OTHER with reasonNote', async () => {
      await service.create({
        buyerId: 100,
        orderId: 'order-1',
        subOrderId: 'so-1',
        items: [{ orderItemId: 'oi-1', quantity: 1 }],
        reason: ReturnReason.OTHER,
        reasonNote: 'Custom reason here.',
      });
      expect(returnsRepo.create).toHaveBeenCalled();
    });

    it('should reject when more than 5 attachments are provided', async () => {
      filesService.findByIds.mockResolvedValue([
        { id: 'f1' },
        { id: 'f2' },
        { id: 'f3' },
        { id: 'f4' },
        { id: 'f5' },
        { id: 'f6' },
      ] as never);
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
          fileIds: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'],
        }),
      ).rejects.toThrow(/5 attachments/i);
    });

    it('should reject when fileId does not exist', async () => {
      filesService.findByIds.mockResolvedValue([{ id: 'f1' }] as never);
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
          fileIds: ['f1', 'f-missing'],
        }),
      ).rejects.toThrow(/file/i);
    });
  });

  describe('confirmShippedBack', () => {
    it('should transition APPROVED -> SHIPPED_BACK with tracking', async () => {
      const existing = new Return();
      existing.id = 'r-1';
      existing.buyerId = 100;
      existing.status = ReturnStatus.APPROVED;
      returnsRepo.findById.mockResolvedValue(existing);
      const updated = new Return();
      updated.status = ReturnStatus.SHIPPED_BACK;
      returnsRepo.markShippedBack.mockResolvedValue(updated);

      await service.confirmShippedBack({
        buyerId: 100,
        returnId: 'r-1',
        trackingNumber: 'TRK123',
      });

      expect(returnsRepo.markShippedBack).toHaveBeenCalledWith({
        id: 'r-1',
        trackingNumber: 'TRK123',
        shippedBackAt: NOW,
      });
    });

    it('should reject buyer who does not own the return', async () => {
      const existing = new Return();
      existing.id = 'r-1';
      existing.buyerId = 999;
      existing.status = ReturnStatus.APPROVED;
      returnsRepo.findById.mockResolvedValue(existing);
      await expect(
        service.confirmShippedBack({
          buyerId: 100,
          returnId: 'r-1',
          trackingNumber: 'TRK',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject when status is not APPROVED', async () => {
      const existing = new Return();
      existing.id = 'r-1';
      existing.buyerId = 100;
      existing.status = ReturnStatus.REQUESTED;
      returnsRepo.findById.mockResolvedValue(existing);
      await expect(
        service.confirmShippedBack({
          buyerId: 100,
          returnId: 'r-1',
          trackingNumber: 'TRK',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('vendorTransition', () => {
    const existingApproveable = (): Return => {
      const r = new Return();
      r.id = 'r-1';
      r.vendorId = 'vendor-1';
      r.subOrderId = 'so-1';
      r.status = ReturnStatus.REQUESTED;
      r.items = [
        Object.assign(
          {},
          {
            id: 'ri-1',
            returnRequestId: 'r-1',
            orderItemId: 'oi-1',
            quantity: 1,
            refundAmountMinor: '5000',
            createdAt: NOW,
          },
        ),
      ] as never;
      return r;
    };

    it('should approve REQUESTED return', async () => {
      returnsRepo.findById.mockResolvedValue(existingApproveable());
      const updated = new Return();
      updated.status = ReturnStatus.APPROVED;
      returnsRepo.markApproved.mockResolvedValue(updated);

      await service.vendorTransition({
        vendorId: 'vendor-1',
        returnId: 'r-1',
        targetStatus: ReturnStatus.APPROVED,
      });

      expect(returnsRepo.markApproved).toHaveBeenCalledWith({
        id: 'r-1',
        decidedAt: NOW,
      });
    });

    it('should reject with reason', async () => {
      returnsRepo.findById.mockResolvedValue(existingApproveable());
      const updated = new Return();
      updated.status = ReturnStatus.REJECTED;
      returnsRepo.markRejected.mockResolvedValue(updated);

      await service.vendorTransition({
        vendorId: 'vendor-1',
        returnId: 'r-1',
        targetStatus: ReturnStatus.REJECTED,
        rejectReason: 'Not eligible',
      });

      expect(returnsRepo.markRejected).toHaveBeenCalledWith({
        id: 'r-1',
        rejectReason: 'Not eligible',
        rejectedAt: NOW,
        fromStatus: ReturnStatus.REQUESTED,
      });
    });

    it('should require rejectReason on REJECTED', async () => {
      returnsRepo.findById.mockResolvedValue(existingApproveable());
      await expect(
        service.vendorTransition({
          vendorId: 'vendor-1',
          returnId: 'r-1',
          targetStatus: ReturnStatus.REJECTED,
        }),
      ).rejects.toThrow(/rejectReason/i);
    });

    it('should mark RECEIVED with restock and pass stockIncrements', async () => {
      const r = existingApproveable();
      r.status = ReturnStatus.SHIPPED_BACK;
      returnsRepo.findById.mockResolvedValue(r);
      ordersRepo.findOrderIdForSubOrder.mockResolvedValue('order-1');
      ordersRepo.findHydratedById.mockResolvedValue({
        ...mockOrder(),
        subOrders: [
          {
            id: 'so-1',
            vendorId: 'vendor-1',
            fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
            deliveredAt: DELIVERED_AT,
            items: [
              {
                id: 'oi-1',
                variantId: 'var-1',
                quantity: 2,
                unitPriceSnapshot: '5000',
              },
            ],
          },
        ] as never,
      } as never);
      const updated = new Return();
      updated.status = ReturnStatus.RECEIVED;
      returnsRepo.markReceived.mockResolvedValue(updated);

      await service.vendorTransition({
        vendorId: 'vendor-1',
        returnId: 'r-1',
        targetStatus: ReturnStatus.RECEIVED,
        restock: true,
      });

      expect(returnsRepo.markReceived).toHaveBeenCalledWith({
        id: 'r-1',
        restock: true,
        receivedAt: NOW,
        stockIncrements: [{ variantId: 'var-1', delta: 1 }],
      });
    });

    it('should require restock field on RECEIVED', async () => {
      const r = existingApproveable();
      r.status = ReturnStatus.SHIPPED_BACK;
      returnsRepo.findById.mockResolvedValue(r);
      await expect(
        service.vendorTransition({
          vendorId: 'vendor-1',
          returnId: 'r-1',
          targetStatus: ReturnStatus.RECEIVED,
        }),
      ).rejects.toThrow(/restock/i);
    });

    it('should reject vendor who does not own the return (404 not 403)', async () => {
      const r = existingApproveable();
      r.vendorId = 'other-vendor';
      returnsRepo.findById.mockResolvedValue(r);
      await expect(
        service.vendorTransition({
          vendorId: 'vendor-1',
          returnId: 'r-1',
          targetStatus: ReturnStatus.APPROVED,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should auto-flip sub-order to RETURNED when all items closed', async () => {
      const r = existingApproveable();
      r.status = ReturnStatus.REFUNDED;
      returnsRepo.findById.mockResolvedValue(r);
      returnsRepo.markClosed.mockResolvedValue({
        ...r,
        status: ReturnStatus.CLOSED,
        subOrderId: 'so-1',
      } as never);
      ordersRepo.findOrderIdForSubOrder = jest
        .fn()
        .mockResolvedValue('order-1');
      ordersRepo.findHydratedById = jest.fn().mockResolvedValue(
        mockOrder({
          subOrders: [
            {
              id: 'so-1',
              vendorId: 'vendor-1',
              fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
              deliveredAt: DELIVERED_AT,
              items: [
                {
                  id: 'oi-1',
                  variantId: 'var-1',
                  quantity: 2,
                  unitPriceSnapshot: '5000',
                },
              ],
            },
          ] as never,
        }),
      );
      returnsRepo.sumClosedQuantitiesByOrderItem = jest
        .fn()
        .mockResolvedValue(new Map([['oi-1', 2]]));
      ordersRepo.flipSubOrderToReturnedIfDelivered = jest
        .fn()
        .mockResolvedValue(true);

      await service.vendorTransition({
        vendorId: 'vendor-1',
        returnId: 'r-1',
        targetStatus: ReturnStatus.CLOSED,
      });

      expect(ordersRepo.flipSubOrderToReturnedIfDelivered).toHaveBeenCalledWith(
        'so-1',
      );
    });

    it('should not flip sub-order when only partial items closed', async () => {
      const r = existingApproveable();
      r.status = ReturnStatus.REFUNDED;
      returnsRepo.findById.mockResolvedValue(r);
      returnsRepo.markClosed.mockResolvedValue({
        ...r,
        status: ReturnStatus.CLOSED,
        subOrderId: 'so-1',
      } as never);
      ordersRepo.findOrderIdForSubOrder = jest
        .fn()
        .mockResolvedValue('order-1');
      ordersRepo.findHydratedById = jest.fn().mockResolvedValue(
        mockOrder({
          subOrders: [
            {
              id: 'so-1',
              vendorId: 'vendor-1',
              fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
              deliveredAt: DELIVERED_AT,
              items: [
                {
                  id: 'oi-1',
                  variantId: 'var-1',
                  quantity: 2,
                  unitPriceSnapshot: '5000',
                },
              ],
            },
          ] as never,
        }),
      );
      returnsRepo.sumClosedQuantitiesByOrderItem = jest
        .fn()
        .mockResolvedValue(new Map([['oi-1', 1]]));
      ordersRepo.flipSubOrderToReturnedIfDelivered = jest
        .fn()
        .mockResolvedValue(false);

      await service.vendorTransition({
        vendorId: 'vendor-1',
        returnId: 'r-1',
        targetStatus: ReturnStatus.CLOSED,
      });

      expect(
        ordersRepo.flipSubOrderToReturnedIfDelivered,
      ).not.toHaveBeenCalled();
    });
  });
});
