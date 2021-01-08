// Tell jslint that certain variables are global
/* global afqb, d3, d3_queue, $, dat */

// ========== Adding Table code ============
afqb.table.fieldHeight = 30;
afqb.table.rowPadding = 1;
afqb.table.fieldWidth = 140;

afqb.table.format = d3.time.format("%m/%d/%Y");
//var dateFn = function(date) { return format.parse(d.created_at) };

afqb.table.subData = [];
afqb.table.subGroups = {};
afqb.table.splitGroups = false;

afqb.table.ramp = null;

/**
 * Initialize Table from subject metadata in subjects.csv. Subject rows
 * maintain their order from subjects.csv.
 *
 * @param error - Passed to prevent execution in case error occurs
 * in preceding functions.
 * @param useless - Obligatory callback argument that we don't use in the
 * function.
 * @param {object} data - JavaScript array created by d3.csv(data/subjects.csv).
 */
afqb.table.buildTable = function (error, useless, data) {
	"use strict";
	data.forEach(function (d) {
	    delete d[""];
		Object.keys(d).forEach(function (key) {
			d[key] = +d[key] || d[key];
			if (d[key] === "0") {
				d[key] = +d[key];
			}
		})
	});

	data.forEach(function (d) {
        if (typeof d.subjectID === 'number') {
            d.subjectID = "s" + afqb.global.formatKeyName(d.subjectID.toString());
        } else {
            d.subjectID = afqb.global.formatKeyName(d.subjectID);
        }
		afqb.table.subData.push(d);
	});

	afqb.table.subFormats = {}
    Object.keys(afqb.table.subData[0]).forEach(function (key) {
        var column = afqb.table.subData.map( function (row) {
            return row[key];
        });

        column = column.filter(function (element) {
            return element !== undefined && element !== null;
        });

        function isBinary (e) {
            return e === 1 || e === 0;
        }

        function isNum (e) {
            return !isNaN(+e);
        }

        function isInt(e) {
            return Number.isInteger(+e);
        }

        function identity (arg) {
            return arg;
        }

        if (column.every(isBinary)) {
            afqb.table.subFormats[key] = d3.format("0b");
        } else if (column.every(isNum)) {
            if (column.every(isInt)) {
                afqb.table.subFormats[key] = d3.format("d");
            } else {
                afqb.table.subFormats[key] = function (n) {
                    return parseFloat(d3.format(".4f")(n));
                }
            }
        } else {
            afqb.table.subFormats[key] = identity;
        }
    });

	afqb.table.ramp = null;

    var headerSvg = d3.select("#header-div").append("svg")
		.attr("width", d3.keys(afqb.table.subData[0]).length * afqb.table.fieldWidth)
		.attr("height", afqb.table.fieldHeight + afqb.table.rowPadding);

	afqb.table.headerGrp = headerSvg.append("g").attr("class", "headerGrp")
		// .attr("flex", "0 0 auto");
		.attr("height", afqb.table.fieldHeight + afqb.table.rowPadding);

	var rowsSvg = d3.select("#rows-div").append("svg")
		.attr("width", d3.keys(afqb.table.subData[0]).length * afqb.table.fieldWidth)
		// .attr("height", "100%")
        // .attr("overflow-y", "auto")
		// .attr("display", "flex")
		// .attr("flex-direction", "column")
		.attr("height", afqb.table.subData.length * (afqb.table.fieldHeight + afqb.table.rowPadding));

	afqb.table.rowsGrp = rowsSvg.append("g").attr("class", "rowsGrp")
		// .attr("flex", "1 1 auto")
        // .attr("overflow-y", "auto")
		.attr("height", afqb.table.subData.length * (afqb.table.fieldHeight + afqb.table.rowPadding));

    var tableElement = document.getElementById("table");
    var headerDiv = document.getElementById("header-div");

    tableElement.addEventListener("scroll", function() {
        headerDiv.style.position = "relative";
        headerDiv.style.top = this.scrollTop + "px";
    }, false);

	var TableGuiConfigObj = function () {
		this.groupCount = parseInt(afqb.table.settings.sort.count);
        this.splitMethod = afqb.table.settings.splitMethod;
	};

	afqb.table.gui = new dat.GUI({
		autoplace: false,
		width: 350,
		scrollable: false
	});

	var tableGuiContainer = document.getElementById('table-gui-container');
	tableGuiContainer.appendChild(afqb.table.gui.domElement);

	afqb.global.controls.tableControlBox = new TableGuiConfigObj();

	// Add split method controller
    afqb.table.gui
        .add(afqb.global.controls.tableControlBox, 'splitMethod', ['Equal Size', 'Equal Interval'])
        .name('Grouping Method')
        .onFinishChange(function (value) {
            afqb.table.settings.splitMethod = value;

            // Update the query string
            afqb.global.updateQueryString(
                {table: {splitMethod: afqb.global.formatKeyName(value)}}
            );

            afqb.table.refreshTable();
        });

    // Add group count controller
    var groupCountController = afqb.table.gui
        .add(afqb.global.controls.tableControlBox, 'groupCount')
		.min(1).step(1)
        .name('Number of Groups');

    groupCountController.onFinishChange(function (value) {
        afqb.table.settings.prevSort.count = afqb.table.settings.sort.count;
        afqb.table.settings.sort.count = value;
        afqb.table.refreshTable();
    });

    afqb.table.gui.close();

	afqb.table.refreshTable();
    afqb.table.restoreRowSelection();
};

/**
 * Refresh the Table after sort operations. Subject rows are rearranged in
 * ascending or descending order and colored by group. Number of groups is
 * determined by the user specified value in the Table gui (default = 2).
 * Selection is retained on refresh.
 *
 */
afqb.table.refreshTable = function () {
    "use strict";
    // create the table header
	// We want subjectId to be the first column, so sort the keys using a sort function that puts
	// subjectId before all other values, settings all other values to be equal
    // Use d3.entries followed by sort followed by a map that gets the keys
	// because d3.[keys, values, entries] all have an undefined order. We use d3.entries below to sort
	// the values so we use the same method here for the keys to ensure that the header row has the same
	// order as the body rows.
    var firstCol = "subjectID";
    var sortedKeys = d3.entries(afqb.table.subData[0])
        .sort(function (x,y) { return x.key === firstCol ? -1 : y.key === firstCol ? 1 : 0; })
        .map(function (entry) { return entry.key; });

    var header = afqb.table.headerGrp.selectAll("g")
        .data(sortedKeys)
        .enter().append("g")
        .attr("class", "t_header")
        .attr("transform", function (d, i) {
            return "translate(" + i * afqb.table.fieldWidth + ",0)";
        })
        .on("mouseover", function () {
            d3.select(this).style("cursor", "n-resize");
        })
		// this is where the magic happens...(d) is the column being sorted
        .on("click", function (d) {
			afqb.table.settings.prevSort.key = afqb.table.settings.sort.key;
			afqb.table.settings.sort.key = d;
			afqb.table.settings.prevSort.count = afqb.table.settings.sort.count;
			afqb.table.refreshTable();
		});

    header.append("rect")
        .attr("width", afqb.table.fieldWidth - 1)
        .attr("height", afqb.table.fieldHeight);

    header.append("text")
        .attr("x", afqb.table.fieldWidth / 2)
        .attr("y", afqb.table.fieldHeight / 2)
        .attr("dy", ".35em")
        .text(String);

    // fill the table
    // select rows
    var rows = afqb.table.rowsGrp.selectAll("g.row").data(afqb.table.subData,
        function (d) { return d.subjectID; });

    // create rows
    rows.enter().append("svg:g")
        .attr("class", "row")
        .attr("id", function (d) { return d.subjectID; })
        .attr("transform", function (d, i) {
            return "translate(0," + i * (afqb.table.fieldHeight + afqb.table.rowPadding) + ")";
        })
        //.on('click', afqb.table.rowSelect )
        .on('mouseover', afqb.table.tableMouseDown)
        .on('mousedown', afqb.table.rowSelect);

    // select cells
    var cells = rows.selectAll("g.cell")
		.data(function (d) {
            return d3.entries(d).filter(function (entry) {
                return entry.key !== "group";
            }).sort(function (x,y) {
                return x.key === firstCol ? -1 : y.key === firstCol ? 1 : 0;
            }).map(function (entry) {
                return afqb.table.subFormats[entry.key](entry.value);
            });
		});

    // create cells
    var cellsEnter = cells.enter().append("svg:g")
        .attr("class", "cell")
        .style("opacity", 0.3)
        .attr("transform", function (d, i) {
            return "translate(" + i * afqb.table.fieldWidth + ",0)";
        });

    cellsEnter.append("rect")
        .attr("width", afqb.table.fieldWidth - 1)
        .attr("height", afqb.table.fieldHeight);

    cellsEnter.append("text")
        .attr("x", afqb.table.fieldWidth / 2)
        .attr("y", afqb.table.fieldHeight / 2)
        .attr("dy", ".35em")
        .text(String);

	var sortOn = afqb.table.settings.sort.key;
    // Update if not in initialisation
    if (sortOn !== null) {
        // If sort.key and sort.count are the same, just update the row order
		var sameKey = (sortOn === afqb.table.settings.prevSort.key);
		var sameCount = (afqb.table.settings.sort.count === afqb.table.settings.prevSort.count);
        if (sameKey && sameCount && !afqb.table.settings.restoring) {
			if (afqb.table.settings.sort.order === "ascending") {
				rows.sort(function (a, b) {
					return afqb.table.descendingWithNull(a[sortOn], b[sortOn]);
				});
				afqb.table.settings.prevSort.order = "ascending";
				afqb.table.settings.sort.order = "descending";
			} else {
				rows.sort(function (a, b) {
					return afqb.table.ascendingWithNull(a[sortOn], b[sortOn]);
				});
				afqb.table.settings.prevSort.order = "descending";
				afqb.table.settings.sort.order = "ascending";
			}

            // Update row positions
            rows//.transition()
                //.duration(500)
                .attr("transform", function (d, i) {
                    return "translate(0," + i * (afqb.table.fieldHeight + 1) + ")";
                });
        }

		if (!sameKey && !afqb.table.settings.restoring) {
			// Only resort the data if the sort key is different
			rows.sort(function (a, b) {
				return afqb.table.ascendingWithNull(a[sortOn], b[sortOn]);
			});
			afqb.table.subData.sort(function (a, b) {
				return afqb.table.ascendingWithNull(a[sortOn], b[sortOn]);
			});
			afqb.table.settings.sort.order = "ascending";

            // Update row positions
            rows//.transition()
                //.duration(500)
                .attr("transform", function (d, i) {
                    return "translate(0," + i * (afqb.table.fieldHeight + 1) + ")";
                });
		}

		if (!sameKey || !sameCount || afqb.table.settings.restoring) {
            console.assert(afqb.table.settings.splitMethod === "Equal Size" || afqb.table.settings.splitMethod === "Equal Interval", "Split method must be 'Equal Size' or 'Equal Interval'");

            // Get unique, non-null values from the column `sortOn`
            var uniqueNotNull = function (value, index, self) {
                return (self.indexOf(value) === index) && (value !== null);
            };

            var uniques = afqb.table.subData
                .map(function (element) {
                    return element[sortOn];
                })
                .filter(uniqueNotNull);

			// usrGroups is the user requested number of groups
            // numGroups may be smaller if there are not enough unique values
            var usrGroups = afqb.table.settings.sort.count;
            var numGroups = Math.min(usrGroups, uniques.length);
						// var groupScale;

            // Create groupScale to map between the unique
            // values and the discrete group indices.
            // TODO: Use the datatype json instead of
            // just testing the first element of uniques
            if (typeof uniques[0] === 'number') {
                if (afqb.table.settings.splitMethod === "Equal Size" || numGroups === 1) {
                    // Split into groups of equal size
                    afqb.table.groupScale = d3.scale.quantile()
                        .range(d3.range(numGroups));

                    afqb.table.groupScale.domain(uniques);
                } else {
                    // Split into groups of equal interval
                    afqb.table.groupScale = d3.scale.quantize()
                        .range(d3.range(numGroups));

                    afqb.table.groupScale.domain([d3.min(uniques), d3.max(uniques)]);
                }
            } else {
                var rangeOrdinal = new Array(uniques.length);
                for (let i = 0; i < numGroups; i++) {
                    rangeOrdinal.fill(i,
                            i * uniques.length / numGroups,
                            (i + 1) * uniques.length / numGroups);
                }
                afqb.table.groupScale = d3.scale.ordinal()
                    .range(rangeOrdinal);

                afqb.table.groupScale.domain(uniques);
            }

			// Assign group index to each element of afqb.table.subData
			afqb.table.subData.forEach(function(element) {
				if (element[sortOn] === null) {
					element.group = null;
					afqb.table.subGroups[element.subjectID] = null;
				} else {
					element.group = afqb.table.groupScale(element[sortOn]);
					afqb.table.subGroups[element.subjectID] = afqb.table.groupScale(element[sortOn]);
				}
			});

			// Prepare to split on group index
			afqb.table.splitGroups = d3.nest()
				.key(function (d) { return d.group; })
				.entries(afqb.table.subData);

			// Create color ramp for subject groups
			afqb.table.ramp = d3.scale.linear()
				.domain([0, numGroups-1]).range(["red", "blue"]);

			afqb.global.idColor = function (element) {
				d3.selectAll('#' + element.subjectID)
					.selectAll('.line')
					.style("stroke",
							element.group === null ? "black" : afqb.table.ramp(element.group));

				d3.selectAll('#' + element.subjectID)
					.selectAll('.cell').select('text')
					.style("fill",
							element.group === null ? "black" : afqb.table.ramp(element.group));
			};

			afqb.table.subData.forEach(afqb.global.idColor); // color lines

			d3.csv("data/nodes.csv", afqb.plots.changePlots);

            if (afqb.table.settings.restoring) {
                if (afqb.table.settings.sort.order === "ascending") {
                    rows.sort(function (a, b) {
                        return afqb.table.ascendingWithNull(a[sortOn], b[sortOn]);
                    });
                } else {
                    rows.sort(function (a, b) {
                        return afqb.table.descendingWithNull(a[sortOn], b[sortOn]);
                    });
                }

                // Update row positions
                rows//.transition()
                    //.duration(500)
                    .attr("transform", function (d, i) {
                        return "translate(0," + i * (afqb.table.fieldHeight + 1) + ")";
                    });
            }
			afqb.table.settings.restoring = false;
		}
    }

    // Update the query string
    var table = {
        prevSort: afqb.table.settings.prevSort,
        sort: afqb.table.settings.sort
    };
    afqb.global.updateQueryString(
        {table: table}
    );
};

/**
 * Sort rows in ascending order. Elements a and b
 * are sorted with d3.ascending, and their associated
 * rows are similarly ordered.
 *
 * @param {element} a - value in sorting column for the first
 * object
 * @param {element} b - value in sorting column for the second
 * object
 */
afqb.table.ascendingWithNull = function (a, b) {
    "use strict";
	// d3.ascending ignores null and undefined values
	// Return the same as d3.ascending but keep all null and
	// undefined values at the bottom of the list
	return b === null ? -1 : a === null ? 1 : d3.ascending(a, b);
};

/**
 * Sort rows in descending order. Elements a and b
 * are sorted with d3.descending, and their associated
 * rows are similarly ordered.
 *
 * @param {element} a - value in sorting column for the first
 * object
 * @param {element} b - value in sorting column for the second
 * object
 */
afqb.table.descendingWithNull = function (a, b) {
    "use strict";
	// d3.descending ignores null and undefined values
	// Return the same as d3.descending but keep all null and
	// undefined values at the bottom of the list
	return b === null ? -1 : a === null ? 1 : d3.descending(a, b);
};

// onclick function to toggle on and off rows
/**
 * Select subject by row. Change opacity of row
 * and corresponding subject lines in 2D plots.
 *
 */
afqb.table.rowSelect = function () {
    "use strict";
    if($('g',this).css("opacity") == 0.3) {
		afqb.table.settings.selectedRows[this.id] = true;
		//uses the opacity of the row for selection and deselection
        d3.selectAll('#' + this.id)
			.selectAll('g')
            .style("opacity", 1);

		d3.selectAll('#' + this.id)
			.selectAll('path')
            .style("opacity", 1)
            .style("stroke-width", "2.1px");
    } else {
		afqb.table.settings.selectedRows[this.id] = false;
		d3.selectAll('#' + this.id)
			.selectAll('g')
			.style("opacity", 0.3);

        d3.selectAll('#' + this.id)
			.selectAll('path')
            .style("opacity", afqb.global.controls.plotsControlBox.lineOpacity)
            .style("stroke-width", "1.1px");
	}

	// Update the query string
    var selectedRows = {};
    selectedRows[this.id] = afqb.table.settings.selectedRows[this.id];

    afqb.global.updateQueryString(
        {table: {selectedRows: selectedRows}}
    );
};

afqb.global.mouse.isDown = false;   // Tracks status of mouse button

$(document).mousedown(function() {
        "use strict";
		// When mouse goes down, set isDown to true
		afqb.global.mouse.isDown = true;
	})
    .mouseup(function() {
        "use strict";
		// When mouse goes up, set isDown to false
        afqb.global.mouse.isDown = false;
    });

/**
 * Define subject selection and deselection by
 * drag.
 *
 */
afqb.table.tableMouseDown = function () {
    "use strict";
	if(afqb.global.mouse.isDown) {
		if($('g',this).css("opacity") == 0.3) {
            afqb.table.settings.selectedRows[this.id] = true;
			//uses the opacity of the row for selection and deselection
			d3.selectAll('#' + this.id)
				.selectAll('g')
				.style("opacity", 1);

			d3.selectAll('#' + this.id)
				.selectAll('path')
				.style("opacity", 1)
				.style("stroke-width", "2.1px");
		} else {
            afqb.table.settings.selectedRows[this.id] = false;
			d3.selectAll('#' + this.id)
				.selectAll('g')
				.style("opacity", 0.3);

			d3.selectAll('#' + this.id)
				.selectAll('path')
				.style("opacity", afqb.global.controls.plotsControlBox.lineOpacity)
				.style("stroke-width", "1.1px");
		}

        // Update the query string
        var selectedRows = {};
        selectedRows[this.id] = afqb.table.settings.selectedRows[this.id];

        afqb.global.updateQueryString(
            {table: {selectedRows: selectedRows}}
        );
	}
};

afqb.global.queues.subjectQ = d3_queue.queue();
afqb.global.queues.subjectQ.defer(afqb.global.initSettings);
afqb.global.queues.subjectQ.defer(d3.csv, "data/subjects.csv");
afqb.global.queues.subjectQ.await(afqb.table.buildTable);
