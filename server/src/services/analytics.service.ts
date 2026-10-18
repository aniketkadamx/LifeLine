import mongoose from "mongoose";
import {
  User,
  Payment,
  Appointment,
  Order,
  DoctorProfile,
  PharmacyProfile,
} from "../models/index.js";
import {
  UserRole,
  UserStatus,
  PaymentStatus,
  AppointmentStatus,
  OrderStatus,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import type { AnalyticsDateFilterQuery } from "../validators/analytics.validator.js";

/**
 * Currency-grouped transaction aggregate.
 */
export interface CurrencyFinancialAggregate {
  currency: string;
  grossTransactionVolume: number;
  totalRefunds: number;
  netTransactionVolume: number;
  successfulTransactions: number;
  refundedTransactions: number;
}

/**
 * Platform administration overview metrics payload.
 */
export interface AdminOverviewMetrics {
  userMetrics: {
    totalUsers: number;
    activeUsers: number;
    byRole: Record<string, number>;
    byStatus: Record<string, number>;
  };
  financialMetrics: {
    grossTransactionVolume: number;
    totalRefunds: number;
    netTransactionVolume: number;
    currency: string;
    currencies: CurrencyFinancialAggregate[];
  };
  appointmentMetrics: {
    totalAppointments: number;
    completedAppointments: number;
    eligibleAppointments: number;
    completionRate: number; // Percentage with 2-decimal precision (e.g. 85.5)
    overallCompletionRate: number;
    byStatus: Record<string, number>;
  };
  orderMetrics: {
    totalOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    byStatus: Record<string, number>;
  };
  period: {
    from?: string;
    to?: string;
  };
}

/**
 * Doctor-scoped consultation and earnings metrics payload.
 */
export interface DoctorAnalyticsMetrics {
  doctorId: string;
  consultationMetrics: {
    totalAppointments: number;
    completedConsultations: number;
    completionRate: number;
    byStatus: Record<string, number>;
  };
  earningsSummary: {
    totalEarnings: number;
    currency: string;
    completedPaidConsultations: number;
    currencies: Array<{
      currency: string;
      totalEarnings: number;
      completedPaidCount: number;
    }>;
    pendingEarnings: Array<{
      currency: string;
      totalPending: number;
      pendingCount: number;
    }>;
    commissionModel: {
      platformCommissionRate: number;
      description: string;
    };
  };
  period: {
    from?: string;
    to?: string;
  };
}

/**
 * Pharmacy-scoped fulfillment and revenue metrics payload.
 */
export interface PharmacyAnalyticsMetrics {
  pharmacyId: string;
  pharmacyName: string;
  fulfillmentMetrics: {
    totalOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    fulfillmentRate: number;
    byStatus: Record<string, number>;
  };
  revenueSummary: {
    totalRevenue: number;
    currency: string;
    deliveredPaidOrders: number;
    currencies: Array<{
      currency: string;
      totalRevenue: number;
      subtotalRevenue: number;
      deliveryFeeRevenue: number;
      fulfilledOrdersCount: number;
    }>;
  };
  period: {
    from?: string;
    to?: string;
  };
}

export class AnalyticsService {
  /**
   * Builds an indexed date-range filter for MongoDB aggregation stages.
   */
  private buildDateFilter(
    fieldName: string,
    filter?: AnalyticsDateFilterQuery
  ): Record<string, unknown> | null {
    if (!filter?.from && !filter?.to) {
      return null;
    }
    const range: Record<string, Date> = {};
    if (filter.from) {
      range.$gte = new Date(filter.from);
    }
    if (filter.to) {
      range.$lte = new Date(filter.to);
    }
    return { [fieldName]: range };
  }

  /**
   * Calculates platform-wide operational and financial analytics.
   * Restricted strictly to administrators.
   *
   * Sources:
   * - docs/api/API_CONTRACT.md Group 19.1
   * - docs/api/AUTHORIZATION_MATRIX.md Section 1 & Line 81
   */
  public async getAdminOverview(
    filter?: AnalyticsDateFilterQuery
  ): Promise<AdminOverviewMetrics> {
    // 1. User Aggregation: total count, breakdown by role, breakdown by status
    const userMatch: Record<string, unknown> = {};
    const userDateRange = this.buildDateFilter("createdAt", filter);
    if (userDateRange) {
      Object.assign(userMatch, userDateRange);
    }

    const userStats = await User.aggregate([
      { $match: userMatch },
      {
        $facet: {
          total: [{ $count: "count" }],
          byRole: [{ $group: { _id: "$role", count: { $sum: 1 } } }],
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        },
      },
    ]);

    const totalUsers = userStats[0]?.total[0]?.count ?? 0;
    const byRole: Record<string, number> = {
      [UserRole.PATIENT]: 0,
      [UserRole.DOCTOR]: 0,
      [UserRole.PHARMACY]: 0,
      [UserRole.ADMIN]: 0,
    };
    for (const item of userStats[0]?.byRole ?? []) {
      if (item._id) byRole[item._id] = item.count;
    }

    const byStatus: Record<string, number> = {
      [UserStatus.ACTIVE]: 0,
      [UserStatus.PENDING_VERIFICATION]: 0,
      [UserStatus.SUSPENDED]: 0,
      [UserStatus.DEACTIVATED]: 0,
    };
    for (const item of userStats[0]?.byStatus ?? []) {
      if (item._id) byStatus[item._id] = item.count;
    }
    const activeUsers = byStatus[UserStatus.ACTIVE] ?? 0;

    // 2. Financial Aggregation: Authoritative gross volume, refunds, and net volume grouped by currency
    // Qualifying captured payments: SUCCESS, REFUND_PENDING, REFUNDED.
    // Excluded non-successful: CREATED, PENDING_GATEWAY, PROCESSING, FAILED, EXPIRED.
    const paymentMatch: Record<string, unknown> = {
      status: {
        $in: [
          PaymentStatus.SUCCESS,
          PaymentStatus.REFUND_PENDING,
          PaymentStatus.REFUNDED,
        ],
      },
    };
    const paymentDateRange = this.buildDateFilter("createdAt", filter);
    if (paymentDateRange) {
      Object.assign(paymentMatch, paymentDateRange);
    }

    const financialAggregates: CurrencyFinancialAggregate[] =
      await Payment.aggregate([
        { $match: paymentMatch },
        {
          $group: {
            _id: "$currency",
            grossTransactionVolume: { $sum: "$amount" },
            totalRefunds: {
              $sum: {
                $cond: [
                  { $gt: ["$refundAmount", 0] },
                  "$refundAmount",
                  {
                    $cond: [
                      { $eq: ["$status", PaymentStatus.REFUNDED] },
                      "$amount",
                      0,
                    ],
                  },
                ],
              },
            },
            successfulTransactions: { $sum: 1 },
            refundedTransactions: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$status", PaymentStatus.REFUNDED] },
                      { $gt: ["$refundAmount", 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            currency: "$_id",
            grossTransactionVolume: { $round: ["$grossTransactionVolume", 2] },
            totalRefunds: { $round: ["$totalRefunds", 2] },
            netTransactionVolume: {
              $round: [
                { $subtract: ["$grossTransactionVolume", "$totalRefunds"] },
                2,
              ],
            },
            successfulTransactions: 1,
            refundedTransactions: 1,
          },
        },
      ]);

    // Compute primary currency totals (defaults to INR or first available currency)
    const primaryCurrency =
      financialAggregates.find((c) => c.currency === "INR") ??
      financialAggregates[0];

    const financialMetrics = {
      grossTransactionVolume: primaryCurrency?.grossTransactionVolume ?? 0,
      totalRefunds: primaryCurrency?.totalRefunds ?? 0,
      netTransactionVolume: primaryCurrency?.netTransactionVolume ?? 0,
      currency: primaryCurrency?.currency ?? "INR",
      currencies: financialAggregates,
    };

    // 3. Appointment Completion Rate Aggregation:
    // Denominator = Terminal appointments eligible for completion (COMPLETED, CANCELLED, REJECTED, NO_SHOW).
    // Numerator = COMPLETED appointments.
    const appointmentMatch: Record<string, unknown> = {};
    const appointmentDateRange = this.buildDateFilter("scheduledStart", filter);
    if (appointmentDateRange) {
      Object.assign(appointmentMatch, appointmentDateRange);
    }

    const appointmentCounts: Array<{ _id: string; count: number }> =
      await Appointment.aggregate([
        { $match: appointmentMatch },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

    const appointmentStatusBreakdown: Record<string, number> = {
      [AppointmentStatus.PENDING_PAYMENT]: 0,
      [AppointmentStatus.CONFIRMED]: 0,
      [AppointmentStatus.IN_PROGRESS]: 0,
      [AppointmentStatus.COMPLETED]: 0,
      [AppointmentStatus.CANCELLED]: 0,
      [AppointmentStatus.REJECTED]: 0,
      [AppointmentStatus.RESCHEDULED]: 0,
      [AppointmentStatus.NO_SHOW]: 0,
    };

    let totalAppointments = 0;
    for (const item of appointmentCounts) {
      if (item._id) {
        appointmentStatusBreakdown[item._id] = item.count;
      }
      totalAppointments += item.count;
    }

    const completedAppointments =
      appointmentStatusBreakdown[AppointmentStatus.COMPLETED] ?? 0;
    const eligibleAppointments =
      completedAppointments +
      (appointmentStatusBreakdown[AppointmentStatus.CANCELLED] ?? 0) +
      (appointmentStatusBreakdown[AppointmentStatus.REJECTED] ?? 0) +
      (appointmentStatusBreakdown[AppointmentStatus.NO_SHOW] ?? 0);

    const completionRate =
      eligibleAppointments > 0
        ? Number(((completedAppointments / eligibleAppointments) * 100).toFixed(2))
        : 0;

    const overallCompletionRate =
      totalAppointments > 0
        ? Number(((completedAppointments / totalAppointments) * 100).toFixed(2))
        : 0;

    // 4. Orders High-Level Summary
    const orderMatch: Record<string, unknown> = {};
    const orderDateRange = this.buildDateFilter("createdAt", filter);
    if (orderDateRange) {
      Object.assign(orderMatch, orderDateRange);
    }

    const orderCounts: Array<{ _id: string; count: number }> =
      await Order.aggregate([
        { $match: orderMatch },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

    const orderStatusBreakdown: Record<string, number> = {};
    let totalOrders = 0;
    for (const item of orderCounts) {
      if (item._id) {
        orderStatusBreakdown[item._id] = item.count;
      }
      totalOrders += item.count;
    }
    const deliveredOrders = orderStatusBreakdown[OrderStatus.DELIVERED] ?? 0;
    const cancelledOrders = orderStatusBreakdown[OrderStatus.CANCELLED] ?? 0;

    return {
      userMetrics: {
        totalUsers,
        activeUsers,
        byRole,
        byStatus,
      },
      financialMetrics,
      appointmentMetrics: {
        totalAppointments,
        completedAppointments,
        eligibleAppointments,
        completionRate,
        overallCompletionRate,
        byStatus: appointmentStatusBreakdown,
      },
      orderMetrics: {
        totalOrders,
        deliveredOrders,
        cancelledOrders,
        byStatus: orderStatusBreakdown,
      },
      period: {
        from: filter?.from,
        to: filter?.to,
      },
    };
  }

  /**
   * Calculates doctor-specific operational and earnings metrics.
   * Strictly authorized and scoped to the authenticated doctor.
   *
   * Sources:
   * - docs/api/API_CONTRACT.md Group 19.2
   * - docs/api/AUTHORIZATION_MATRIX.md Section 1 & Line 81
   */
  public async getDoctorMetrics(
    doctorUserId: string,
    filter?: AnalyticsDateFilterQuery
  ): Promise<DoctorAnalyticsMetrics> {
    const doctorUserObjectId = new mongoose.Types.ObjectId(doctorUserId);

    // Resolve both User ID and DoctorProfile ID to match all appointments assigned to this doctor
    const docProfile = await DoctorProfile.findOne({
      userId: doctorUserObjectId,
    }).lean();

    const doctorIdentities: mongoose.Types.ObjectId[] = [doctorUserObjectId];
    if (docProfile?._id) {
      doctorIdentities.push(docProfile._id as mongoose.Types.ObjectId);
    }

    const matchDoctorAppointments: Record<string, unknown> = {
      doctorId: { $in: doctorIdentities },
    };
    const dateRange = this.buildDateFilter("scheduledStart", filter);
    if (dateRange) {
      Object.assign(matchDoctorAppointments, dateRange);
    }

    // Execute aggregated facet in MongoDB
    const doctorAggregation = await Appointment.aggregate([
      { $match: matchDoctorAppointments },
      {
        $facet: {
          statusBreakdown: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ],
          earningsByCurrency: [
            {
              $match: {
                status: AppointmentStatus.COMPLETED,
                paymentStatus: "PAID",
              },
            },
            {
              $group: {
                _id: "$currency",
                totalEarnings: { $sum: "$fee" },
                completedPaidCount: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                currency: "$_id",
                totalEarnings: { $round: ["$totalEarnings", 2] },
                completedPaidCount: 1,
              },
            },
          ],
          pendingEarnings: [
            {
              $match: {
                status: AppointmentStatus.COMPLETED,
                paymentStatus: { $in: ["PENDING", "UNPAID"] },
              },
            },
            {
              $group: {
                _id: "$currency",
                totalPending: { $sum: "$fee" },
                pendingCount: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                currency: "$_id",
                totalPending: { $round: ["$totalPending", 2] },
                pendingCount: 1,
              },
            },
          ],
        },
      },
    ]);

    const facetResult = doctorAggregation[0];
    const statusBreakdown: Record<string, number> = {
      [AppointmentStatus.PENDING_PAYMENT]: 0,
      [AppointmentStatus.CONFIRMED]: 0,
      [AppointmentStatus.IN_PROGRESS]: 0,
      [AppointmentStatus.COMPLETED]: 0,
      [AppointmentStatus.CANCELLED]: 0,
      [AppointmentStatus.REJECTED]: 0,
      [AppointmentStatus.RESCHEDULED]: 0,
      [AppointmentStatus.NO_SHOW]: 0,
    };

    let totalAppointments = 0;
    for (const item of facetResult?.statusBreakdown ?? []) {
      if (item._id) {
        statusBreakdown[item._id] = item.count;
      }
      totalAppointments += item.count;
    }

    const completedConsultations =
      statusBreakdown[AppointmentStatus.COMPLETED] ?? 0;
    const completionRate =
      totalAppointments > 0
        ? Number(((completedConsultations / totalAppointments) * 100).toFixed(2))
        : 0;

    const earningsByCurrency: Array<{
      currency: string;
      totalEarnings: number;
      completedPaidCount: number;
    }> = facetResult?.earningsByCurrency ?? [];

    const pendingEarnings: Array<{
      currency: string;
      totalPending: number;
      pendingCount: number;
    }> = facetResult?.pendingEarnings ?? [];

    const primaryCurrencyEarnings =
      earningsByCurrency.find((c) => c.currency === "INR") ??
      earningsByCurrency[0];

    return {
      doctorId: doctorUserId,
      consultationMetrics: {
        totalAppointments,
        completedConsultations,
        completionRate,
        byStatus: statusBreakdown,
      },
      earningsSummary: {
        totalEarnings: primaryCurrencyEarnings?.totalEarnings ?? 0,
        currency: primaryCurrencyEarnings?.currency ?? "INR",
        completedPaidConsultations:
          primaryCurrencyEarnings?.completedPaidCount ?? 0,
        currencies: earningsByCurrency,
        pendingEarnings,
        commissionModel: {
          platformCommissionRate: 0.0,
          description:
            "Platform commission deduction is currently 0.00% (direct consultation fee pass-through).",
        },
      },
      period: {
        from: filter?.from,
        to: filter?.to,
      },
    };
  }

  /**
   * Calculates pharmacy-specific order fulfillment and sales revenue metrics.
   * Strictly authorized and scoped to the authenticated pharmacy.
   *
   * Sources:
   * - docs/api/API_CONTRACT.md Group 19
   * - docs/api/AUTHORIZATION_MATRIX.md Section 1 & Line 81
   */
  public async getPharmacyMetrics(
    pharmacyUserId: string,
    filter?: AnalyticsDateFilterQuery
  ): Promise<PharmacyAnalyticsMetrics> {
    const pharmacyUserObjectId = new mongoose.Types.ObjectId(pharmacyUserId);

    // Resolve owning pharmacy profile
    const pharmacyProfile = await PharmacyProfile.findOne({
      userId: pharmacyUserObjectId,
    }).lean();

    if (!pharmacyProfile) {
      throw AppError.notFound(
        "Pharmacy profile not found for authenticated user",
        "PHARMACY_PROFILE_NOT_FOUND"
      );
    }

    const pharmacyId = pharmacyProfile._id as mongoose.Types.ObjectId;

    const orderMatch: Record<string, unknown> = {
      pharmacyId,
    };
    const dateRange = this.buildDateFilter("createdAt", filter);
    if (dateRange) {
      Object.assign(orderMatch, dateRange);
    }

    // Execute aggregation pipelines on Order
    const pharmacyAggregation = await Order.aggregate([
      { $match: orderMatch },
      {
        $facet: {
          statusBreakdown: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ],
          revenueByCurrency: [
            {
              $match: {
                status: OrderStatus.DELIVERED,
                paymentStatus: "PAID",
              },
            },
            {
              $group: {
                _id: "$currency",
                totalRevenue: { $sum: "$totals.totalAmount" },
                subtotalRevenue: { $sum: "$totals.subtotal" },
                deliveryFeeRevenue: { $sum: "$totals.deliveryFee" },
                fulfilledOrdersCount: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                currency: "$_id",
                totalRevenue: { $round: ["$totalRevenue", 2] },
                subtotalRevenue: { $round: ["$subtotalRevenue", 2] },
                deliveryFeeRevenue: { $round: ["$deliveryFeeRevenue", 2] },
                fulfilledOrdersCount: 1,
              },
            },
          ],
        },
      },
    ]);

    const facetResult = pharmacyAggregation[0];
    const statusBreakdown: Record<string, number> = {
      [OrderStatus.PLACED]: 0,
      [OrderStatus.PRESCRIPTION_REVIEW]: 0,
      [OrderStatus.PHARMACY_ACCEPTED]: 0,
      [OrderStatus.PREPARING]: 0,
      [OrderStatus.READY_FOR_DELIVERY]: 0,
      [OrderStatus.OUT_FOR_DELIVERY]: 0,
      [OrderStatus.DELIVERED]: 0,
      [OrderStatus.CANCELLED]: 0,
      [OrderStatus.REJECTED]: 0,
      [OrderStatus.FAILED]: 0,
      [OrderStatus.RETURNED]: 0,
    };

    let totalOrders = 0;
    for (const item of facetResult?.statusBreakdown ?? []) {
      if (item._id) {
        statusBreakdown[item._id] = item.count;
      }
      totalOrders += item.count;
    }

    const deliveredOrders = statusBreakdown[OrderStatus.DELIVERED] ?? 0;
    const cancelledOrders = statusBreakdown[OrderStatus.CANCELLED] ?? 0;
    const fulfillmentRate =
      totalOrders > 0
        ? Number(((deliveredOrders / totalOrders) * 100).toFixed(2))
        : 0;

    const revenueByCurrency: Array<{
      currency: string;
      totalRevenue: number;
      subtotalRevenue: number;
      deliveryFeeRevenue: number;
      fulfilledOrdersCount: number;
    }> = facetResult?.revenueByCurrency ?? [];

    const primaryCurrencyRevenue =
      revenueByCurrency.find((c) => c.currency === "INR") ??
      revenueByCurrency[0];

    return {
      pharmacyId: pharmacyId.toString(),
      pharmacyName: pharmacyProfile.pharmacyName,
      fulfillmentMetrics: {
        totalOrders,
        deliveredOrders,
        cancelledOrders,
        fulfillmentRate,
        byStatus: statusBreakdown,
      },
      revenueSummary: {
        totalRevenue: primaryCurrencyRevenue?.totalRevenue ?? 0,
        currency: primaryCurrencyRevenue?.currency ?? "INR",
        deliveredPaidOrders: primaryCurrencyRevenue?.fulfilledOrdersCount ?? 0,
        currencies: revenueByCurrency,
      },
      period: {
        from: filter?.from,
        to: filter?.to,
      },
    };
  }
}

export const analyticsService = new AnalyticsService();
