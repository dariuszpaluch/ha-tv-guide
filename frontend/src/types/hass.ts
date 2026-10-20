/** The small part of the Home Assistant frontend object that the card uses. */
export interface HomeAssistant {
  connection: {
    sendMessagePromise: <T>(message: Record<string, unknown>) => Promise<T>;
  };
  /** `notifyOnError: false` stops HA from showing its own error toast. The promise still rejects. */
  callService: (
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: Record<string, string | string[]>,
    notifyOnError?: boolean,
  ) => Promise<unknown>;
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
