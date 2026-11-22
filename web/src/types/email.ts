export type EmailProvider = 'gmail' | 'microsoft' | 'thunderbird';

export type EmailPermissionMode = 'read' | 'draft_triage' | 'full_send';

export type EmailFolderType =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'archive'
  | 'trash'
  | 'spam'
  | 'custom';

export type EmailActionType =
  | 'draft'
  | 'reply_draft'
  | 'send'
  | 'reply_send'
  | 'archive'
  | 'move'
  | 'delete'
  | 'mark_read'
  | 'mark_unread'
  | 'star'
  | 'unstar';

export type EmailActionStatus =
  | 'pending_approval'
  | 'queued'
  | 'claimed'
  | 'executed'
  | 'rejected'
  | 'failed';

export interface EmailFolderRef {
  id: string;
  name: string;
  type: EmailFolderType;
  path?: string;
  unreadCount?: number;
}

export interface EmailAccountPublic {
  id: string;
  provider: EmailProvider;
  email_address: string;
  display_name: string;
  account_label: string;
  provider_account_id: string | null;
  identity_id: string | null;
  folders_json: EmailFolderRef[];
  permission_mode: EmailPermissionMode;
  auto_send_allowed: boolean;
  auto_delete_allowed: boolean;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_device: string | null;
  last_error: string | null;
  unreadCount?: number;
  totalCached?: number;
}

export interface EmailMessageRecord {
  id: string;
  account_id: string;
  provider: EmailProvider;
  account_email: string;
  provider_message_id: string;
  thread_id: string | null;
  folder_id: string | null;
  folder_name: string;
  folder_type: EmailFolderType;
  subject: string;
  from_name: string;
  from_email: string;
  to_list: string[];
  cc_list: string[];
  date_iso: string;
  snippet: string;
  body_text: string | null;
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  labels_json: string[];
  synced_at: string;
}

export interface EmailActionPayload {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  bodyText?: string;
  replyToMessageId?: string;
  replyToProviderMessageId?: string;
  replyToThreadId?: string;
  replyAll?: boolean;
  messageIds?: string[];
  providerMessageIds?: string[];
  messageSubjects?: string[];
  targetFolder?: string;
  targetFolderId?: string;
}

export interface EmailActionRecord {
  id: string;
  account_id: string;
  account_email: string;
  provider: EmailProvider;
  action_type: EmailActionType;
  status: EmailActionStatus;
  source: string;
  payload_json: EmailActionPayload;
  rationale: string;
  device_claim_id: string | null;
  claimed_at: string | null;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  executed_at: string | null;
  updated_at: string;
}

export interface EmailSafetyConfigPublic {
  microsoftConfigured: boolean;
  microsoftClientIdPreview: string | null;
  gmailConfigured: boolean;
  require_approval_for_send: boolean;
  require_approval_for_delete: boolean;
}
