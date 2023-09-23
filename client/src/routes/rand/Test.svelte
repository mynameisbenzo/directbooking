<script>
    import { randName } from "../../api/api.js";

    let data = newName();
  
    async function newName() {
      data = await randName();
      return data
      }
  </script>
  
  <h2>This input (Svelte) is sent to a dynamic server and added to a random number (Python & Flask):</h2>
<button
  class="btn btn-primary"
  on:click={() => data = newName()}>New Name</button>
  
  <p>Dynamically generated result: {(data.name) ? data.name : "... Generating ... "}</p>
    
    