import { tagElement } from "taggedjs";
import { App } from "./components/App.tag.js";
import { actions } from "./controller.js";
import "./styles.css";
import { startNavigation } from "./navigation.js";

const root = document.getElementById("app");
if (!root) throw new Error("Glanceboard app root was not found");

const stopNavigation = startNavigation();
tagElement(App, root);
void actions.start();
window.addEventListener("beforeunload", () => {
  stopNavigation();
  actions.stop();
});
