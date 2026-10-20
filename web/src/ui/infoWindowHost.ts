/** A live cockpit surface; info content itself remains mounted at App level. */
export interface InfoWindowHost {
  readonly element: HTMLElement;
  readonly mobile: boolean;
  topZ(): number;
  reveal(): void;
}
