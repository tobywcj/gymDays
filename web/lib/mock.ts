// Re-export shared types so existing imports keep working.
export type { ClientStatus, AgentType } from "./types";
import type { ClientView, ClientStatus, AgentType } from "./types";

export const clients: ClientView[] = [
  { id: "1", name: "Sarah Mitchell", goal: "Fat Loss",        lastSession: "Today, 9am",   strava: true,  status: "Active"  },
  { id: "2", name: "James Okafor",   goal: "Hypertrophy",     lastSession: "Yesterday",    strava: true,  status: "Active"  },
  { id: "3", name: "Priya Nair",     goal: "Marathon Prep",   lastSession: "2 days ago",   strava: false, status: "Active"  },
  { id: "4", name: "Tom Hargreaves", goal: "Rehab / Strength",lastSession: "4 days ago",   strava: true,  status: "Resting" },
  { id: "5", name: "Ella Fontaine",  goal: "General Fitness", lastSession: "1 week ago",   strava: false, status: "Flagged" },
];

export const agentFeed: Array<{
  id: number;
  agent: AgentType;
  time: string;
  text: string;
  cite: string | null;
}> = [
  { id: 1, agent: "Progress",    time: "2 min ago",  text: "Weekly check-in summary sent to Sarah Mitchell.",       cite: "wk12-checkin" },
  { id: 2, agent: "Strava Sync", time: "18 min ago", text: "Synced 3 runs for James Okafor — 47.2 km total.",       cite: null            },
  { id: 3, agent: "Reminder",    time: "1 hr ago",   text: "Session reminder pushed to Priya Nair for tomorrow 7am.", cite: null          },
  { id: 4, agent: "Research",    time: "3 hrs ago",  text: "HRV drop detected for Tom Hargreaves — flagged report.",  cite: "hrv-2024"    },
  { id: 5, agent: "Progress",    time: "5 hrs ago",  text: "Monthly progress report compiled for Ella Fontaine.",    cite: "apr-report"  },
];

export const chartData = [
  { week: "Wk 1", weight: 88.2, hrv: 58, volume: 12400 },
  { week: "Wk 2", weight: 87.5, hrv: 61, volume: 13100 },
  { week: "Wk 3", weight: 87.1, hrv: 55, volume: 12800 },
  { week: "Wk 4", weight: 86.4, hrv: 63, volume: 14200 },
  { week: "Wk 5", weight: 86.0, hrv: 67, volume: 14800 },
  { week: "Wk 6", weight: 85.3, hrv: 64, volume: 15600 },
  { week: "Wk 7", weight: 84.9, hrv: 70, volume: 15200 },
  { week: "Wk 8", weight: 84.1, hrv: 72, volume: 16400 },
];

export const navItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "clients",   label: "Clients" },
  { id: "programme", label: "Programme" },
  { id: "knowledge", label: "Knowledge Base" },
  { id: "messages",  label: "Messages" },
] as const;
