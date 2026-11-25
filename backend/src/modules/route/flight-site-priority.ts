import { Injectable } from '@nestjs/common';

@Injectable()
export class FlightSitePriority {
  private requests = 0;

  begin() {
    this.requests++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.requests--;
    };
  }

  get busy() { return this.requests > 0; }
}
