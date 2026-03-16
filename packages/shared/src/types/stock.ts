export interface Stock {
  symbol: string;
  name: string;
  type: 'adr' | 'us' | 'crypto';
  flag: string;
}
