import Vue from "vue";
import axios from "axios";

const state = {
  topics: {
    MS_23_1: {
      name: "MS_23_1",
      partitions: 2
    },
    MS_23_2: {
      name: "MS_23_2",
      partitions: 2
    }
  }
};

const getters = {
  topicsRegExp: state => regexp => {
    let topics = {};
    Object.keys(state.topics).forEach(key => {
      let topic = state.topics[key];
      if (topic.name.match(regexp)) {
        topics[key] = topic;
      }
    });
    console.log("topicsRegExp return", topics);
    return topics;
  }
};

const mutations = {
  updateTopics(state, payload) {
    Object.keys(state.topics).forEach(key => Vue.delete(state.topics, key));
    Object.keys(payload).forEach(key =>
      Vue.set(state.topics, key, payload[key])
    );
  }
};

const actions = {
  reloadTopics({ commit }) {
    axios.get("/api/topics/.*").then(response => {
      console.log("Response from Server: ", response);
      let topics = {};
      Object.keys(response.data).forEach(key => {
        topics[key] = {
          name: response.data[key].topic,
          partitions: response.data[key].numPartitions
        };
      });
      commit("updateTopics", topics);
    });
  }
};

export default {
  namespaced: true,
  state,
  mutations,
  actions,
  getters
};
