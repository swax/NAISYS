export interface Agent {
  id: number;
  name: string;
  title: string;
  online: boolean;
  lastActive?: string;
  agentPath?: string;
  leadUsername?: string;
}
