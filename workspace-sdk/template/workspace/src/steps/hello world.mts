export const match = () => ({
  hello: String
});

export default (data: any) => {
  console.log(`hello ${data.hello}`);
  data.greeted = true;
};
