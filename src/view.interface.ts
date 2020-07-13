
import { Observable, observable } from 'rxjs';
import { EachMessagePayload } from "kafkajs";

class ViewDB {
  public id: string;
  public view: string;
  public regexp: string;

  public constructor(id: string, view: string, regexp: string) {
    this.id = id;
    this.view = view;
    this.regexp = regexp;
  }
}

class View {
  public viewDB: ViewDB;
  public regexp: RegExp;
  public observable: Observable<EachMessagePayload>;

  public constructor(id: string, view: string, regexp: string, observable: Observable<EachMessagePayload>) {
    this.viewDB = new ViewDB(id, view, regexp);
    this.regexp = new RegExp(regexp);
    this.observable = observable;
  }
}

export {
  View,
  ViewDB
};