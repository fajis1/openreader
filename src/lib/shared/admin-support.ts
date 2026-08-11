export type AdminSupportView =
  | 'overview'
  | 'users'
  | 'jobs'
  | 'payments'
  | 'requests'
  | 'system'
  | 'audit';

export type SupportQuota = {
  unlimited: boolean;
  used: number;
  freeLimit: number;
  freeUsed: number;
  freeRemaining: number;
  supportCreditsRemaining: number;
  totalRemaining: number;
  resetTimeMs: number;
};

export type SupportUserSummary = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt: number;
  lastActiveAt: number;
  documentCount: number;
  audiobookCount: number;
  storageBytes: number;
  activeJobCount: number;
  failedJobCount: number;
  quota: SupportQuota;
};

export type SupportDocument = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
};

export type SupportJob = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  documentId: string;
  documentTitle: string;
  status: string;
  progress: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  voice: string | null;
  model: string | null;
  format: string | null;
  smartAudio: boolean;
  monthlyQuotaCharge: boolean;
};

export type SupportCreditGrant = {
  id: string;
  credits: number;
  debtOffset: number;
  note: string | null;
  createdByAdminId: string | null;
  createdAt: number;
};

export type SupportCreditConsumption = {
  id: string;
  jobId: string;
  createdAt: number;
};

export type SupportCreditRevocation = {
  id: string;
  credits: number;
  removedCredits: number;
  note: string | null;
  createdAt: number;
};

export type SupportUserDetail = {
  user: SupportUserSummary;
  supportPackage: {
    minimumUsd: number;
    extraAudiobooks: number;
  };
  recentDocuments: SupportDocument[];
  recentJobs: SupportJob[];
  creditHistory: {
    grantedTotal: number;
    consumedTotal: number;
    revokedTotal: number;
    available: number;
    outstandingDebt: number;
    grants: SupportCreditGrant[];
    consumptions: SupportCreditConsumption[];
    revocations: SupportCreditRevocation[];
  };
};

export type SupportUsersResponse = {
  users: SupportUserSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type SupportJobsResponse = {
  jobs: SupportJob[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type SupportPayment = {
  id: string;
  userId: string;
  userEmail: string | null;
  environment: string;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  status: string;
  amountCents: number;
  currency: string;
  credits: number;
  creditsGranted: number;
  creditsRevoked: number;
  reversalShortfall: number;
  failureCode: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  reversedAt: number | null;
};

export type SupportPaymentsResponse = {
  payments: SupportPayment[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  paypal: {
    enabled: boolean;
    environment: 'sandbox' | 'live';
    credentialsConfigured: boolean;
    webhookConfigured: boolean;
    siteOriginConfigured: boolean;
    liveHttpsReady: boolean;
  };
};

export type SupportJoinRequest = {
  id: string;
  email: string;
  name: string | null;
  intendedUse: string;
  heardAbout: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
  updatedAt: number;
  decidedAt: number | null;
  decisionNote: string | null;
};

export type SupportAuditEvent = {
  id: string;
  adminUserId: string;
  adminEmail: string | null;
  targetUserId: string | null;
  targetEmail: string | null;
  action: string;
  resourceId: string | null;
  amount: number | null;
  note: string | null;
  createdAt: number;
};

export type SupportAuditResponse = {
  events: SupportAuditEvent[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type SupportOverview = {
  userCount: number;
  documentCount: number;
  audiobookCount: number;
  activeJobCount: number;
  failedJobCount: number;
  pendingRequestCount: number;
  recentFailures: SupportJob[];
  recentAudit: SupportAuditEvent[];
};

export const SUPPORT_ACTIVE_JOB_STATUSES = [
  'queued',
  'running',
  'pausing',
  'waiting_for_pdf',
  'waiting_for_voices',
] as const;
