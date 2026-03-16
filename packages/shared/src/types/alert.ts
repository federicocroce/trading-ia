export type AlertType = 'price' | 'signal' | 'news' | 'system';

export interface Alert {
  id: string;
  message: string;
  type: AlertType;
  timestamp: number;
  read: boolean;
}
