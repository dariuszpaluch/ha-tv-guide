import { css } from 'lit';

/** Look of the card: the frame, the search and list panels, the hints and the switch toast. */
export const tvGuideStyles = css`
  :host {
    display: block;
  }
  .frame {
    --tvg-track: color-mix(in srgb, var(--primary-text-color) 10%, transparent);
    --tvg-mark: color-mix(in srgb, var(--primary-color) 30%, transparent);
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    overflow: hidden;
    border-radius: 18px;
    background: var(--primary-background-color);
    color: var(--primary-text-color);
    font-size: 14px;
  }
  .panel {
    border: 1px solid var(--divider-color);
    border-radius: 12px;
    background: var(--card-background-color);
  }
  tvg-search-box {
    flex: none;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .section {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: 12px 16px 6px;
    background: var(--card-background-color);
    color: var(--secondary-text-color);
    font-size: 12px;
    font-weight: 500;
  }
  .searching {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    color: var(--secondary-text-color);
    font-size: 13px;
  }
  .spinner {
    width: 16px;
    height: 16px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid var(--tvg-track);
    border-top-color: var(--primary-color);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      rotate: 360deg;
    }
  }
  .empty {
    padding: 32px 16px;
    text-align: center;
    color: var(--secondary-text-color);
    line-height: 1.5;
  }
  .stale {
    flex: none;
    padding: 0 4px;
    color: var(--secondary-text-color);
    font-size: 12.5px;
  }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 20px;
    translate: -50%;
    z-index: 50;
    max-width: 90%;
    padding: 10px 16px;
    border-radius: 8px;
    background: var(--primary-text-color);
    color: var(--card-background-color);
    font-size: 13.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 3px 10px var(--divider-color);
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      animation: none !important;
    }
  }
`;
