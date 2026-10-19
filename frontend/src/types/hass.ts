/** The small part of the Home Assistant frontend object that the card uses. */
export interface HomeAssistant {
  connection: {
    sendMessagePromise: <T>(message: Record<string, unknown>) => Promise<T>;
  };
  callService: (domain: string, service: string, data?: Record<string, unknown>) => Promise<unknown>;
  locale: {
    language: string;
    time_format: 'language' | 'system' | '12' | '24';
    time_zone: 'local' | 'server';
  };
  config: {
    time_zone: string;
  };
  themes: {
    darkMode: boolean;
  };
}
