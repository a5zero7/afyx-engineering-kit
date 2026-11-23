export class BaseGateway {
  send(): boolean {
    return false;
  }
}

export class CustomGateway extends BaseGateway {
  override send(): boolean {
    return true;
  }
}

