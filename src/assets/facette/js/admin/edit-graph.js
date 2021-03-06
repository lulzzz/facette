app.controller('AdminEditGraphController', function($q, $rootScope, $routeParams, $scope, $timeout, adminEdit, bulk,
    catalog, globalHotkeys, library, ngDialog, series) {

    $scope.section = 'graphs';
    $scope.id = $routeParams.id;
    $scope.linked = $scope.id == 'link';
    $scope.tab = 0;

    $scope.seriesTemplate = {};

    // Define helper functions
    function fetchGroups(callback) {
        var groupQuery = [],
            expandQuery = [];

        $scope.groupNames = {};

        angular.forEach($scope.item.groups, function(group) {
            angular.forEach(group.series, function(series) {
                angular.forEach([series.source, series.metric], function(entry, idx) {
                    if (!entry.startsWith(groupPrefix)) {
                        return;
                    }

                    groupQuery.push({
                        endpoint: 'library/' + (idx === 0 ? 'source' : 'metric') + 'groups/' +
                            entry.substr(groupPrefix.length),
                        method: 'GET',
                        params: {fields: 'id,name'}
                    });
                });

                if (series.template) {
                    return;
                }

                if (series.source.startsWith(groupPrefix) || series.metric.startsWith(groupPrefix)) {
                    series.expansion = expandQuery.length;
                    expandQuery.push(series);
                }
            });
        });

        // Resolve existing source and metric groups names and fetch expansion data
        $scope.expandData = [];

        var queries = [];
        if (groupQuery.length > 0) {
            queries.push(bulk.exec(groupQuery).$promise);
        }
        if (expandQuery.length > 0) {
            queries.push(series.expand(expandQuery).$promise);
        }

        if (!queries) {
            return;
        }

        $q.all(queries).then(function(data) {
            angular.forEach(data[0], function(entry) {
                if (entry.status == 200) {
                    $scope.groupNames[entry.data.id] = entry.data.name;
                }
            });

            var out = [];
            angular.forEach(data[1], function(entry, idx) {
                out[idx] = [];
                angular.forEach(entry, function(a) { out[idx].push(a); });
            });
            $scope.expandData = out;

            if (callback) {
                callback();
            }
        });
    }

    function updateItemDef() {
        var def = angular.copy($scope.item);
        $scope.cleanProperties(def);
        def.attributes = angular.copy($scope.item.attributes);

        if (
            $scope.itemDef &&
            angular.equals(def.groups, $scope.itemDef.groups) &&
            angular.equals(def.options, $scope.itemDef.options) &&
            angular.equals(def.attributes, $scope.itemDef.attributes)
        ) {
            return;
        }

        $scope.itemDef = def;
    }

    function updateTemplate(item) {
        var attrs = {},
            keys = [],
            entries = [];

        item = item || $scope.item;

        // Parse templatable fields for attribute names
        entries.push(item.description);
        if (item.options) {
            entries.push(item.options.title);
        }

        angular.forEach(entries, function(input) {
            if (input) {
                keys = keys.concat(input.matchAll(templateRegexp));
            }
        });

        // Parse series for attribute names
        angular.forEach(item.groups, function(group) {
            angular.forEach(group.series, function(series) {
                var subkeys = (
                    series.origin + '\x1e' +
                    series.source + '\x1e' +
                    series.metric
                ).matchAll(templateRegexp);

                if (subkeys.length > 0) {
                    series.template = true;
                }

                keys = keys.concat(subkeys);
            });
        });

        // Prepare attributes object and keys list
        keys.sort();
        keys = jQuery.unique(keys);

        angular.forEach(keys, function(key, idx) {
            if (attrs[key] === undefined) {
                attrs[key] = item.attributes && item.attributes[key] ? item.attributes[key] : null;
            }
        });

        $scope.templateKeys = keys;

        if ($scope.linked) {
            item.attributes = attrs;
        } else {
            item.template = keys.length > 0;

            if (item.template) {
                item.attributes = attrs;
                delete item.alias;
            } else {
                delete item.attributes;
            }
        }
    }

    function setDefaults(input) {
        return angular.extend({
            options: {
                type: graphTypeArea,
                stack_mode: graphStackModeNone,
                yaxis_center: true,
                yaxis_unit: graphYAxisUnitFixed
            }
        }, input);
    }

    // Define scope functions
    $scope.cancel = function(force) { adminEdit.cancel($scope, force); };
    $scope.delete = function() { adminEdit.delete($scope, {id: $scope.id, name: $scope.itemRef.name}); };
    $scope.reset = function() { adminEdit.reset($scope); fetchGroups(); updateItemDef(); };

    $scope.save = function(go) {
        adminEdit.save($scope, function(data) {
            if (data.options) {
                if (data.options.constants) {
                    data.options.constants = parseFloatList(data.options.constants);
                }

                if (data.options.percentiles) {
                    data.options.percentiles = parseFloatList(data.options.percentiles);
                }
            }
        }, function(item) {
            if ($scope.linked && !item.link) {
                return false;
            }

            return true;
        }, go);
    };

    $scope.remove = function(list, entry) {
        adminEdit.remove($scope, list, entry);

        // Remove empty groups from list
        angular.forEach($scope.item.groups, function(group, idx) {
            if (group.series.length === 0) {
                $scope.item.groups.splice(idx, 1);
            }
        });

        // Update template status
        updateTemplate();
    };

    $scope.cleanProperties = function(data) {
        if (!$scope.linked) {
            delete data.attributes;
        }

        // Remove UI-specific properties
        angular.forEach(data.groups, function(group) {
            delete group.selected;

            angular.forEach(group.series, function(series) {
                delete series.autoname;
                delete series.expanded;
                delete series.expansion;
                delete series.template;
            });
        });
    };

    $scope.selectSeries = function(e, data) {
        if (typeof data == 'string') {
            $scope.series.entries[$scope.seriesCurrent][this.id] = data;
        } else {
            $scope.groupNames[data.id] = data.name;
            $scope.series.entries[$scope.seriesCurrent][this.id] = groupPrefix + data.id;
        }

        if (e.type == 'blur') {
            return;
        }

        var next;

        switch (this.id) {
        case 'origin':
            next = '#source input';
            break;

        case 'source':
            next = '#metric input';
            break;
        }

        if (!next) {
            return;
        }

        $scope.$applyAsync(function() { angular.element(next).focus(); });
    };

    $scope.selectTemplate = function(e, data) {
        $scope.item.link = data;
    };

    $scope.setSeries = function() {
        if (!$scope.item.groups) {
            $scope.item.groups = [];
        }

        // Set series as auto-named
        $scope.series.entries.map(function(entry) {
            entry.autoname = true;
            return entry;
        });

        if ($scope.series.index !== undefined) {
            $scope.item.groups[$scope.series.index].series = angular.copy($scope.series.entries);
            $scope.resetSeries(false, true);
        } else {
            $scope.item.groups.push({series: angular.copy($scope.series.entries)});
            $scope.resetSeries(false, false);
        }

        // Update template status
        updateTemplate();

        if ($scope.series.hasGroups) {
            fetchGroups(function() { $scope.autonameSeries(false); });
        } else {
            $scope.autonameSeries(false);
        }
    };

    $scope.editOptions = function(state) {
        $scope.options = angular.copy($scope.item.options);
        $scope.optionsEdit = state;
    };

    $scope.setOptions = function() {
        angular.extend($scope.item.options, $scope.options);
        $scope.optionsEdit = false;
    };

    $scope.editGroup = function(group) {
        $scope.groupItem = angular.copy(group);

        $scope.seriesCurrent = 0;
        $scope.seriesTotal = group.series.length;
        $scope.completing = false;

        $scope.switchEdit = function(isGroup, delta) {
            $scope.groupEdit = isGroup;

            if (!$scope.groupEdit && delta) {
                $scope.seriesCurrent += delta;
            }

            $timeout(function() {
                angular.element('.ngdialog-content :input:visible:first').select();
            }, 50);
        };

        // Restore select values
        if ($scope.groupItem.consolidate === 0) {
            $scope.groupItem.consolidate = groupConsolidateAverage;
        }

        if (!$scope.groupItem.options) {
            $scope.groupItem.options = {};
        }

        if ($scope.groupItem.options.interpolate === undefined) {
            $scope.groupItem.options.interpolate = true;
        }

        $scope.selectedOptions.group = {
            operator: $scope.groupOperators[$scope.groupItem.operator],
            consolidate: $scope.groupConsolidations[$scope.groupItem.consolidate - 1]
        };

        // Open groups edition modal pane
        ngDialog.open({
            template: 'templates/admin/edit-graphs-groups.html',
            scope: $scope,
            controller: function($scope) {
                $timeout(function() {
                    $scope.switchEdit($scope.seriesTotal > 1 || $scope.groupItem.series[0].expansion !== undefined);
                }, 0);
            },
            showClose: false
        }).closePromise.then(function(scope) {
            scope.$dialog.remove();

            if ([undefined, '$document', '$escape'].indexOf(scope.value) != -1) {
                return;
            }

            var data = scope.value,
                idx = $scope.item.groups.indexOf(group);

            if (data.options && data.options.scale) {
                data.options.scale = parseFloat(data.options.scale);
            }

            for (var i in data.series) {
                // Reset auto-naming flag on name change
                if ($scope.item.groups[idx].series[i].name !== data.series[i].name) {
                    data.series[i].autoname = false;
                }

                if (data.series[i].options && data.series[i].options.scale) {
                    data.series[i].options.scale = parseFloat(data.series[i].options.scale);
                }
            }

            angular.extend(group, data);
        });
    };

    $scope.editSeries = function(group) {
        var idx = $scope.item.groups.indexOf(group);
        if (idx == -1) {
            return;
        }

        $scope.series = {index: idx, entries: angular.copy($scope.item.groups[idx].series)};
        $scope.seriesCurrent = 0;
        $scope.seriesTotal = group.series.length;

        $scope.switchSeries(0);
    };

    $scope.switchSeries = function(delta) {
        $scope.seriesCurrent += delta;

        var series = $scope.series.entries[$scope.seriesCurrent];

        angular.element('#origin input').val(series.origin);
        angular.element('#source input').val($scope.resolveGroup(series.source));
        angular.element('#metric input').val($scope.resolveGroup(series.metric));

        $timeout(function() { angular.element('#metric input').select(); }, 0);
    };

    $scope.autonameSeries = function(force) {
        force = typeof force == 'boolean' ? force : false;

        var originRef = null,
            sourceRef = null,
            originMany = false,
            sourceMany = false;

        angular.forEach($scope.item.groups, function(group) {
            angular.forEach(group.series, function(series) {
                if (originRef === null && sourceRef === null) {
                    originRef = series.origin;
                    sourceRef = series.source;
                } else {
                    if (!originMany && originRef !== series.origin) {
                        originMany = true;
                    }
                    if (!sourceMany && sourceRef !== series.source) {
                        sourceMany = true;
                    }
                }
            });
        });

        angular.forEach($scope.item.groups, function(group) {
            angular.forEach(group.series, function(series) {
                if (!force && !series.autoname) {
                    return;
                }

                var name = $scope.resolveGroup(series.metric);
                if (sourceMany) {
                    name = series.source + '/' + name;
                }
                if (originMany) {
                    name = series.origin + '/' + name;
                }

                series.name = name;
                series.autoname = true;
            });
        });
    };

    $scope.mergeGroup = function(state) {
        if (state) {
            angular.forEach($scope.selected.slice(1), function(group) {
                $scope.selected[0].series = $scope.selected[0].series.concat(group.series);
                $scope.item.groups.splice($scope.item.groups.indexOf(group), 1);
            });

            // Get next available group name
            var maxId = 0;
            angular.forEach($scope.item.groups, function(group) {
                if (group.name && group.name.startsWith('group')) {
                    maxId = Math.max(maxId, parseInt(group.name.substr(5), 10));
                }
            });

            if (!$scope.selected[0].name) {
                $scope.selected[0].name = 'group' + (maxId + 1);
            }
        } else {
            angular.forEach($scope.selected, function(group) {
                var items = [];

                angular.forEach(group.series, function(series) {
                    items.push({
                        name: series.name,
                        series: [series]
                    });
                });

                $scope.item.groups.splice.apply($scope.item.groups,
                    [$scope.item.groups.indexOf(group), 1].concat(items));
            });
        }
    };

    $scope.expandGroup = function(group, state) {
        if (state) {
            // Generate expansion nodes
            var items = [],
                seriesList = [];

            angular.forEach($scope.expandData[group.series[0].expansion], function(entry) {
                var series = {
                    origin: entry.origin,
                    source: entry.source,
                    metric: entry.metric,
                    autoname: true,
                    expanded: $scope.groupTmp.length
                };

                items.push({series: [series]});
                seriesList.push(series);
            });

            group.expanded = seriesList;

            // Save group for later collapse
            $scope.groupTmp.push($scope.item.groups.splice($scope.item.groups.indexOf(group), 1)[0]);

            // Insert new nodes
            $scope.item.groups.splice.apply($scope.item.groups,
                [$scope.item.groups.indexOf(group) + 1, 0].concat(items));

            // Trigger series auto-naming
            $scope.autonameSeries(false);
        } else {
            $rootScope.showModal({
                type: dialogTypeConfirm,
                message: 'mesg.groups_collapse',
                labels: {
                    validate: 'label.groups_collapse'
                },
                danger: true
            }, function(data) {
                if (data === undefined) {
                    return;
                }

                // Move back saved group to items removing expanded nodes
                angular.forEach($scope.groupTmp[group.series[0].expanded].expanded, function(item, i) {
                   angular.forEach($scope.item.groups, function(group, j) {
                        var idx = group.series.indexOf(item);
                        if (idx != -1) {
                            if (i === 0) {
                                var groupOrig = $scope.groupTmp.splice(group.series[0].expanded, 1)[0];
                                delete groupOrig.expanded;

                                $scope.item.groups.splice(j, 0, groupOrig);
                                j++;
                            }

                            group.series.splice(idx, 1);
                            if (group.series.length === 0) {
                                $scope.item.groups.splice(j, 1);
                            }
                        }
                    });
                });
            });
        }
    };

    $scope.resolveGroup = function(input) {
        if (input && input.startsWith(groupPrefix) && $scope.groupNames) {
            var id = input.substr(groupPrefix.length);
            return $scope.groupNames[id] ? groupPrefix + $scope.groupNames[id] : input;
        }

        return input;
    };

    $scope.resetSeries = function(init, update) {
        init = typeof init == 'boolean' ? init : false;
        update = typeof update == 'boolean' ? update : false;

        $scope.seriesCurrent = 0;

        if (init || update) {
            $scope.series = {entries: [{origin: null, source: null, metric: null}]};
        }

        if (!init) {
            delete $scope.series.index;
            delete $scope.seriesTotal;

            if (update) {
                angular.element('#origin input').val('');
                angular.element('#source input').val('');
            } else {
                delete $scope.series.entries[0].metric;
            }

            $scope.series.valid = false;

            $scope.$applyAsync(function() { angular.element('#metric input').val('').focus(); });
        }
    };

    $scope.getSeriesColor = function(idx) {
        try {
            if ($scope.item.groups[idx].series.length == 1 && $scope.item.groups[idx].series[0].options.color) {
                return $scope.item.groups[idx].series[0].options.color;
            }
        } catch (e) {}

        return chart.colors[idx % chart.colors.length];
    };

    $scope.validateOptionsClose = function() {
        return !$scope.completing;
    };

    $scope.switchTab = function(idx) {
        $scope.tab = idx;

        if (idx == 1) {
            library.list({
                type: 'graphs',
                kind: 'raw',
                link: $scope.id,
                fields: 'id,name'
            }, function(data) {
                $scope.instances = data;
            });
        }
    };

    // Register watchers
    adminEdit.watch($scope, function(newValue, oldValue) {
        if (angular.equals(newValue, oldValue)) {
            return;
        }

        if ($scope.step == 2 && !$scope.linked) {
            updateTemplate();
            updateItemDef();
        } else if ($scope.linked) {
            if (!oldValue || newValue.link !== oldValue.link) {
                library.get({
                    type: 'graphs',
                    id: newValue.link
                }, function(data) {
                    // Restore selected template name
                    if (!oldValue) {
                        $scope.$applyAsync(function() { angular.element('#template input').val(data.name); });
                    }

                    updateTemplate(data);
                    updateItemDef();
                });
            } else if (newValue.link) {
                updateItemDef();
            }
        }
    });

    $scope.$watch('item.groups', function(newValue, oldValue) {
        if (newValue === oldValue) {
            return;
        }

        var selected = [],
            selectedGroup = [];

        angular.forEach($scope.item.groups, function(group) {
            if (!group.selected) {
                return;
            }

            selected.push(group);
            if (group.series.length > 1) {
                selectedGroup.push(group);
            }
        });

        $scope.selected = selected;
        $scope.selectedGroup = selectedGroup;
    }, true);

    $scope.$watch('series', function(newValue, oldValue) {
        if (newValue === oldValue || !$scope.series.entries) {
            return;
        }

        angular.extend($scope.series, {hasGroups: false, valid: true});

        $scope.series.entries.forEach(function(entry) {
            if (entry.source && entry.source.startsWith(groupPrefix) ||
                    entry.metric && entry.metric.startsWith(groupPrefix)) {
                $scope.series.hasGroups = true;
            }

            if (!entry.origin || !entry.source || !entry.metric) {
                $scope.series.valid = false;
            }
        });
    }, true);

    // Initialize scope
    adminEdit.load($scope, function() {
        if ($scope.item.link) {
            $scope.linked = true;
        }

        if (!$scope.linked) {
            $scope.item = setDefaults($scope.item);
        }
        $scope.itemRef = angular.copy($scope.item);

        if (!$scope.linked) {
            $scope.selected = [];
            $scope.selectedGroup = [];
            $scope.selectedOptions = {main: {}, group: {}};
            $scope.groupTmp = [];

            $scope.options = $scope.item.options ? angular.copy($scope.item.options) : {};

            $scope.$watch('step', function(newValue, oldValue) {
                if (angular.equals(newValue, oldValue) || newValue != 2) {
                    return;
                }

                updateTemplate();

                // Fetch example attributes from first template instance
                if ($scope.item.template && $scope.id != 'add') {
                    library.list({
                        type: 'graphs',
                        kind: 'raw',
                        link: $scope.id,
                        fields: 'attributes',
                        limit: 1
                    }, function(data) {
                        if (data && data.length > 0) {
                            $scope.item.attributes = data[0].attributes;
                        }
                    });
                }

                // Trigger initial graph preview update
                updateItemDef();
            });

            $scope.$watch('selectedOptions', function(newValue, oldValue) {
                // Handle select value changes
                if (!angular.equals(newValue.main, oldValue.main)) {
                    angular.forEach(newValue.main, function(entry, key) {
                        $scope.item.options[key] = entry.value;
                    });
                }

                if (!angular.equals(newValue.group, oldValue.group)) {
                    angular.forEach(newValue.group, function(entry, key) {
                        $scope.groupItem[key] = entry.value;
                    });
                }
            }, true);

            $scope.listSortControl.orderChanged = function(e) {
                // Update expanded group series references
                angular.forEach($scope.groupTmp, function(group) {
                    angular.forEach(e.source.itemScope.modelValue.series, function(series, i) {
                        var idx = group.expanded.indexOf(series);
                        if (idx != -1) {
                            group.expanded.splice(idx, 1, $scope.item.groups[e.dest.index].series[i]);
                        }
                    });
                });
            };

            $scope.seriesOrigins = function(term, limit) {
                var defer = $q.defer();

                var query = {type: 'origins'};
                if (term) {
                    query.filter = 'glob:*' + term + '*';
                }
                if (limit) {
                    query.limit = limit;
                }

                catalog.list(query, function(data, headers) {
                    defer.resolve({
                        entries: data.map(function(a) { return {label: a, value: a}; }),
                        total: parseInt(headers('X-Total-Records'), 10)
                    });
                }, function() {
                    defer.reject();
                });

                return defer.promise;
            };

            $scope.seriesSources = function(term, limit) {
                var defer = $q.defer();

                var params = {};
                if (term) {
                    params.filter = 'glob:*' + term + '*';
                }
                if (limit) {
                    params.limit = limit;
                }

                bulk.exec([
                    {
                        endpoint: 'library/sourcegroups/',
                        method: 'GET',
                        params: angular.extend({fields: 'id,name'}, params)
                    },
                    {
                        endpoint: 'catalog/sources/',
                        method: 'GET',
                        params: angular.extend({}, params)
                    }
                ], function(data) {
                    var entries = [];

                    if (data[0].data) {
                        entries = entries.concat(data[0].data.map(function(a) {
                            return {label: a.name, value: a, note: 'group'};
                        }));
                    }

                    if (data[1].data) {
                        entries = entries.concat(data[1].data.map(function(a) { return {label: a, value: a}; }));
                    }

                    defer.resolve({
                        entries: entries,
                        total: parseInt(data[0].headers['X-Total-Records'][0], 10) +
                            parseInt(data[1].headers['X-Total-Records'][0], 10)
                    });
                }, function() {
                    defer.reject();
                });

                return defer.promise;
            };

            $scope.seriesMetrics = function(term, limit) {
                var defer = $q.defer();

                var params = {};
                if (term) {
                    params.filter = 'glob:*' + term + '*';
                }
                if (limit) {
                    params.limit = limit;
                }

                bulk.exec([
                    {
                        endpoint: 'library/metricgroups/',
                        method: 'GET',
                        params: angular.extend({fields: 'id,name'}, params)
                    },
                    {
                        endpoint: 'catalog/metrics/',
                        method: 'GET',
                        params: angular.extend({}, params)
                    }
                ], function(data) {
                    var entries = [];

                    if (data[0].data) {
                        entries = entries.concat(data[0].data.map(function(a) {
                            return {label: a.name, value: a, note: 'group'};
                        }));
                    }

                    if (data[1].data) {
                        entries = entries.concat(data[1].data.map(function(a) { return {label: a, value: a}; }));
                    }

                    defer.resolve({
                        entries: entries,
                        total: parseInt(data[0].headers['X-Total-Records'][0], 10) +
                            parseInt(data[1].headers['X-Total-Records'][0], 10)
                    });
                }, function() {
                    defer.reject();
                });

                return defer.promise;
            };

            $scope.groupOperators = [
                {name: 'None', value: groupOperatorNone},
                {name: 'Average', value: groupOperatorAverage},
                {name: 'Sum', value: groupOperatorSum}
            ];

            $scope.groupConsolidations = [
                {name: 'Average', value: groupConsolidateAverage},
                {name: 'First', value: groupConsolidateFirst},
                {name: 'Last', value: groupConsolidateLast},
                {name: 'Max', value: groupConsolidateMax},
                {name: 'Min', value: groupConsolidateMin},
                {name: 'Sum', value: groupConsolidateSum}
            ];

            $scope.graphTypes = [
                {name: 'Area', value: graphTypeArea},
                {name: 'Line', value: graphTypeLine}
            ];

            $scope.graphStackModes = [
                {name: 'None', value: graphStackModeNone},
                {name: 'Normal', value: graphStackModeNormal},
                {name: 'Percent', value: graphStackModePercent}
            ];

            $scope.resetSeries(true, true);

            // Restore or set main options
            var applyOptions = function(list, key) {
                angular.forEach(list, function(entry) {
                    if (entry.value === $scope.item.options[key]) {
                        $scope.selectedOptions.main[key] = entry;
                    }
                });

                if (!$scope.selectedOptions.main[key]) {
                    $scope.selectedOptions.main[key] = list[0];
                }
            };

            applyOptions($scope.graphTypes, 'type');
            applyOptions($scope.graphStackModes, 'stack_mode');

            // Select first field
            $scope.$applyAsync(function() { angular.element('#origin input').focus(); });

            // Trigger initial group information retrieval
            updateTemplate();
            fetchGroups();
        } else {
            $scope.templateSources = function(term) {
                var defer = $q.defer();

                library.list({
                    type: 'graphs',
                    kind: 'template',
                    fields: 'id,name',
                    filter: 'glob:*' + term + '*'
                }, function(data, headers) {
                    defer.resolve({
                        entries: data.map(function(a) { return {label: a.name, value: a.id}; }),
                        total: parseInt(headers('X-Total-Records'), 10)
                    });
                }, function() {
                    defer.reject();
                });

                return defer.promise;
            };

            // Select first field
            $scope.$applyAsync(function() { angular.element('.pane :input:visible:first').select(); });
        }
    });

    // Register global hotkeys
    globalHotkeys.register($scope);
});
