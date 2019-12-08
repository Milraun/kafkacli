
import { Observable, observable } from 'rxjs';
import { EachMessagePayload } from "kafkajs";

class View {
  public view: string;
  public regexp: RegExp;
  public observable: Observable<EachMessagePayload>;

  public constructor(view: string, regexp: RegExp, observable: Observable<EachMessagePayload>) {
    this.view = view;
    this.regexp = regexp;
    this.observable = observable;
  }
}

export default View;