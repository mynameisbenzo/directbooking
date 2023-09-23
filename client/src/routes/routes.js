import Body from "./rand/Body.svelte";
import Test from "./rand/Test.svelte";
import Index from "./admin/Index.svelte";

export default {
  rand: {
    title: "Random Number",
    key: "rand",
    body: Body,
    params: "123"
  },
  test: {
    title: "yo",
    key: "test",
    body: Test,
    params: "123"
  },
  admin: {
    index: {
      title: "yo",
      key: "Admin",
      body: Index,
      params: "123"
    },
  },
};
