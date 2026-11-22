export const PORTFOLIO_CATEGORIES = [
  'clinical',
  'research',
  'volunteering',
  'leadership',
  'teaching',
  'shadowing',
  'award',
  'extracurricular',
] as const;

export const CANMEDS_ROLES = [
  'Medical Expert',
  'Communicator',
  'Collaborator',
  'Leader',
  'Health Advocate',
  'Scholar',
  'Professional',
] as const;

export interface PortfolioEntry {
  id: string;
  category: (typeof PORTFOLIO_CATEGORIES)[number];
  title: string;
  organization: string;
  role: string;
  start_date: string;
  end_date: string;
  is_ongoing: boolean;
  hours: number;
  verifier_name: string;
  verifier_contact: string;
  canmeds_roles: string[];
  description: string;
  carms_bullets: string[];
  tags: string[];
  created_at?: string;
  updated_at?: string;
}
