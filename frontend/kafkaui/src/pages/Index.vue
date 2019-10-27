<template>
  <q-page class="q-pa-xs">
    <form @submit.prevent="submitForm">
      <div class="row">
        <q-card-section class="col-4">
          <q-input
            ref="input"
            dense
            v-model="regex"
            label="RegExp to filter topics"
            :rules="[isValidRegex]"
          />
        </q-card-section>
        <q-btn
          @click="reloadTopics"
          size="md"
          class="q-ma-lg col-1"
          label="Reload"
          color="primary"
        />
      </div>
    </form>
    <q-list bordered separator>
      <q-item v-for="(topic, key) in topicsByRegExp" :key="key" :topic="topic">
        <q-item-section>
          {{ topic.name }} {{ topic.partitions }}</q-item-section
        >
      </q-item>
    </q-list>
  </q-page>
</template>

<script>
import { mapGetters } from "vuex";
import { mapActions } from "vuex";

export default {
  name: "PageIndex",
  data() {
    return {
      regex: ".*",
      topics: {}
    };
  },
  computed: {
    ...mapGetters("topics", ["topicsRegExp"]),
    topicsByRegExp() {
      if (this.isValidRegex(this.regex)) {
        return this.topicsRegExp(this.regex);
      } else {
        return {};
      }
    }
  },
  methods: {
    ...mapActions("topics", ["reloadTopics"]),
    isValidRegex(val) {
      try {
        new RegExp(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    submitForm() {
      // console.log("Form submitted: regexp", this.regex);
      // this.topics = this.topicsRegExp(this.regex);
      // console.log("topics found !", this.topics);
    }
  },
  mounted() {
    this.reloadTopics();
    this.getTopics();
  }
};
</script>
