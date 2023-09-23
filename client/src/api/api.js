//test with params
export function randData(params = "key for properties") {
  return fetch(`/randData?params=${params}`)
    .then((r) => r.json())
    .then((data) => {
      // console.log(data)
      return data
    })
}
//test without
export function randName(){
  return fetch("/test")
    .then((r) => r.json())
    .then((data) => {
      // console.log(data)
      return data
    })
}
  